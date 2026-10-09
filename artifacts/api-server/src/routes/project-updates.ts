import { Router, type IRouter } from "express";
import { getFilmmakerAccountProjectVisitor, getPublicProjectBySlug, pool } from "@workspace/db";
import {
  ApproveAdminProjectUpdateParams, ApproveAdminProjectUpdateResponse,
  CreateFilmmakerProjectUpdateBody, CreateFilmmakerProjectUpdateParams, CreateFilmmakerProjectUpdateResponse,
  GetAdminProjectUpdatesQueryParams, GetAdminProjectUpdatesResponse,
  GetFilmmakerProjectUpdatesParams, GetFilmmakerProjectUpdatesResponse,
  GetPublicProjectUpdatesParams, GetPublicProjectUpdatesResponse,
  RejectAdminProjectUpdateParams, RejectAdminProjectUpdateResponse,
  GetInvestorUpdateEmailsResponse, SetInvestorUpdateEmailsBody, SetInvestorUpdateEmailsResponse,
  TurnOffUpdateEmailsQueryParams,
} from "@workspace/api-zod";
import { authenticateFilmmaker, resolveProtectedIdentity } from "../lib/filmmaker-auth";
import { LATEST_PREFERENCE_SQL, verifyOptOutToken } from "../lib/update-email-preference";
import { authorizeAdminIdentity } from "../lib/admin-auth";
import { perIpLimit } from "../lib/rate-limit";
import { acceptsPledges } from "../lib/pledge-policy";
import {
  CONSENTING_BACKERS_SQL, TEAM_ROLES, emailDecision, filmmakerUpdateView, milestoneLabel, milestonesForStage,
  nextStatus, publicUpdateView, validateUpdateInput, type UpdateRow,
} from "../lib/project-updates";
import { deliverUpdateEmails, queueUpdateEmails } from "../lib/project-update-email";
import { logger } from "../lib/logger";

// Project updates (DECISIONS.md › Project updates). Approval queues one email per
// consenting confirmed backer, subject to the 14-day rule. Nothing here changes a project's stage.
const router: IRouter = Router();
const postLimit = perIpLimit({ limit: 20, windowMs: 3_600_000, message: "Too many updates. Please try again later." });

const UPDATE_COLUMNS = `u.id, u.milestone_key, u.role, u.person_name, u.name_consent, u.custom_label, u.note,
  u.status, u.created_at, u.reviewed_at`;

type OwnedProject = { id: number; stage: string | null; filmmaker_id: number };

async function ownedProject(uid: string, provider: "firebase" | "replit", projectId: number): Promise<OwnedProject | null> {
  // Same ownership check as /filmmakers/projects/:id/select and /backers.
  if (!await getFilmmakerAccountProjectVisitor(uid, projectId, provider)) return null;
  const { rows } = await pool.query<OwnedProject>("select id, stage, filmmaker_id from projects where id = $1", [projectId]);
  return rows[0] ?? null;
}

async function backersToEmail(projectId: number): Promise<number> {
  const { rows } = await pool.query(CONSENTING_BACKERS_SQL, [projectId]);
  return rows.length;
}

router.get("/filmmakers/projects/:project_id/updates", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const params = GetFilmmakerProjectUpdatesParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid project ID." }); return; }
  const identity = await authenticateFilmmaker(req, res, true);
  if (!identity) return;
  const project = await ownedProject(identity.uid, identity.provider, params.data.project_id);
  if (!project) { res.status(404).json({ error: "Project is not available to this filmmaker account." }); return; }
  const { rows } = await pool.query<UpdateRow>(
    `select ${UPDATE_COLUMNS} from project_updates u where u.project_id = $1 order by u.created_at desc, u.id desc`,
    [project.id],
  );
  res.json(GetFilmmakerProjectUpdatesResponse.parse({
    updates: rows.map(filmmakerUpdateView),
    milestone_options: milestonesForStage(project.stage),
    team_roles: TEAM_ROLES,
    backers_to_email: await backersToEmail(project.id),
  }));
});

router.post("/filmmakers/projects/:project_id/updates", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  if (!postLimit(req, res)) return;
  const params = CreateFilmmakerProjectUpdateParams.safeParse(req.params);
  const body = CreateFilmmakerProjectUpdateBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Check the update and try again." }); return; }
  const identity = await authenticateFilmmaker(req, res, true);
  if (!identity) return;
  const project = await ownedProject(identity.uid, identity.provider, params.data.project_id);
  if (!project) { res.status(404).json({ error: "Project is not available to this filmmaker account." }); return; }
  const checked = validateUpdateInput(project.stage, body.data);
  if (!checked.ok) { res.status(400).json({ error: checked.error }); return; }
  const value = checked.value;
  const { rows } = await pool.query<UpdateRow>(
    `insert into project_updates (project_id, filmmaker_id, milestone_key, role, person_name, name_consent, custom_label, note)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning id, milestone_key, role, person_name, name_consent, custom_label, note, status, created_at, reviewed_at`,
    [project.id, project.filmmaker_id, value.milestone_key, value.role, value.person_name, value.name_consent,
      value.custom_label, value.note],
  );
  res.status(201).json(CreateFilmmakerProjectUpdateResponse.parse(filmmakerUpdateView(rows[0])));
});

type AdminRow = UpdateRow & {
  project_id: number; project_title: string | null; project_slug: string | null;
  filmmaker_name: string | null; filmmaker_email: string | null; reviewed_by: string | null;
  last_queued_at: Date | null;
};
const ADMIN_SELECT = `select ${UPDATE_COLUMNS}, u.project_id, u.reviewed_by,
    p.title as project_title, p.slug as project_slug, f.name as filmmaker_name, f.email as filmmaker_email,
    (select max(o.emails_queued_at) from project_updates o where o.project_id = u.project_id) as last_queued_at
  from project_updates u
  join projects p on p.id = u.project_id
  join filmmakers f on f.id = u.filmmaker_id`;

async function adminView(row: AdminRow, now: Date) {
  return {
    id: row.id, project_id: row.project_id, project_title: row.project_title, project_slug: row.project_slug,
    filmmaker_name: row.filmmaker_name, filmmaker_email: row.filmmaker_email,
    milestone_key: row.milestone_key, label: milestoneLabel(row.milestone_key, row.custom_label),
    role: publicUpdateView(row).role, person_name: row.person_name, note: row.note,
    status: row.status as "pending" | "approved" | "rejected",
    created_at: row.created_at.toISOString(), reviewed_at: row.reviewed_at?.toISOString() ?? null,
    reviewed_by: row.reviewed_by,
    // Rule c: tell the admin before approval whether an email would go out.
    email_decision: emailDecision(row.last_queued_at, now),
    backers_to_email: await backersToEmail(row.project_id),
  };
}

router.get("/admin/project-updates", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const identity = await authorizeAdminIdentity(req, res);
  if (!identity) return;
  const query = GetAdminProjectUpdatesQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: "Invalid status." }); return; }
  const { rows } = await pool.query<AdminRow>(
    `${ADMIN_SELECT} where u.status = $1 order by u.created_at desc, u.id desc limit 200`,
    [query.data.status ?? "pending"],
  );
  const now = new Date();
  res.json(GetAdminProjectUpdatesResponse.parse({ updates: await Promise.all(rows.map((row) => adminView(row, now))) }));
});

async function review(action: "approve" | "reject", updateId: number, reviewer: string) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<{ status: string; project_id: number }>("select status, project_id from project_updates where id = $1 for update", [updateId]);
    if (!rows[0]) { await client.query("rollback"); return { status: 404 as const }; }
    const next = nextStatus(rows[0].status, action);
    if (!next) { await client.query("rollback"); return { status: 409 as const }; }
    await client.query(
      "update project_updates set status = $2, reviewed_by = $3, reviewed_at = now() where id = $1",
      [updateId, next, reviewer],
    );
    const emailIds = next === "approved" ? await queueUpdateEmails(client, updateId, rows[0].project_id) : [];
    await client.query("commit");
    // Deliver after commit; a provider failure never undoes the approval.
    if (emailIds.length) void deliverUpdateEmails(emailIds).catch(() => logger.warn({ updateId }, "Project update email delivery stopped early"));
    return { status: 200 as const };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

for (const action of ["approve", "reject"] as const) {
  router.post(`/admin/project-updates/:update_id/${action}`, async (req, res): Promise<void> => {
    res.set("Cache-Control", "private, no-store");
    const identity = await authorizeAdminIdentity(req, res);
    if (!identity) return;
    const params = (action === "approve" ? ApproveAdminProjectUpdateParams : RejectAdminProjectUpdateParams).safeParse(req.params);
    if (!params.success) { res.status(400).json({ error: "Invalid update ID." }); return; }
    const outcome = await review(action, params.data.update_id, identity.email);
    if (outcome.status === 404) { res.status(404).json({ error: "Update not found." }); return; }
    if (outcome.status === 409) { res.status(409).json({ error: "This update was already reviewed." }); return; }
    const { rows } = await pool.query<AdminRow>(`${ADMIN_SELECT} where u.id = $1`, [params.data.update_id]);
    const view = await adminView(rows[0], new Date());
    res.json((action === "approve" ? ApproveAdminProjectUpdateResponse : RejectAdminProjectUpdateResponse).parse(view));
  });
}

router.get("/projects/:slug/updates", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const params = GetPublicProjectUpdatesParams.safeParse(req.params);
  if (!params.success) { res.status(404).json({ error: "Project not found." }); return; }
  const project = await getPublicProjectBySlug(params.data.slug);
  // Any visible project page (submitted, not hidden) shows its approved updates.
  if (!project || !acceptsPledges(project)) { res.status(404).json({ error: "Project not found." }); return; }
  const { rows } = await pool.query<UpdateRow>(
    `select ${UPDATE_COLUMNS} from project_updates u where u.project_id = $1 and u.status = 'approved'
     order by coalesce(u.reviewed_at, u.created_at) desc, u.id desc`,
    [project.id],
  );
  const listed = project.approved && project.showcaseRequested;
  const listedAt = listed ? (await pool.query<{ listed_at: Date | null }>(
    `select max((entry->>'reviewed_at')::timestamptz) as listed_at
     from projects p, jsonb_array_elements(coalesce(p.review_history, '[]'::jsonb)) entry
     where p.id = $1 and entry->>'approved' = 'true'`,
    [project.id],
  )).rows[0]?.listed_at ?? null : null;
  res.json(GetPublicProjectUpdatesResponse.parse({
    updates: rows.map(publicUpdateView),
    listed_at: listedAt?.toISOString() ?? null,
  }));
});

// Update emails are on by default for backers and can be turned off (rule d, revised).
const optOutLimit = perIpLimit({ limit: 60, windowMs: 300_000, message: "Too many requests. Please try again in a few minutes." });
const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;background:#f6f2ea;color:#202936;max-width:560px;margin:60px auto;padding:0 16px;line-height:1.6"><h1 style="font-size:28px">${title}</h1><p>${body}</p></body></html>`;

router.get("/update-emails/off", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  if (!optOutLimit(req, res)) return;
  const query = TurnOffUpdateEmailsQueryParams.safeParse(req.query);
  const secret = process.env.SESSION_SECRET;
  if (!query.success || !secret || !verifyOptOutToken(query.data.i, query.data.t, secret)) {
    res.status(400).type("html").send(page("This link isn’t valid", "Open the most recent update email and use its link, or turn update emails off from My lineup after signing in."));
    return;
  }
  await pool.query(
    "insert into project_update_email_events (investor_id, allowed, source) values ($1, false, 'email_link')",
    [query.data.i],
  );
  res.type("html").send(page("Update emails are off", "You won’t get project update emails anymore. Your pledges are unchanged. You can turn update emails back on from My lineup."));
});

async function investorIdFor(provider: "firebase" | "replit", uid: string): Promise<number | null> {
  const column = provider === "firebase" ? "firebase_uid" : "replit_uid";
  const { rows } = await pool.query<{ id: number }>(`select id from investors where ${column} = $1 limit 1`, [uid]);
  return rows[0]?.id ?? null;
}

async function preferenceView(investorId: number | null) {
  if (!investorId) return { enabled: true, has_investor_record: false };
  const { rows } = await pool.query<{ allowed: boolean }>(LATEST_PREFERENCE_SQL, [investorId]);
  return { enabled: rows[0]?.allowed ?? true, has_investor_record: true };
}

router.get("/investor/update-emails", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const identity = await resolveProtectedIdentity(req, res, true);
  if (!identity) return;
  res.json(GetInvestorUpdateEmailsResponse.parse(await preferenceView(await investorIdFor(identity.provider, identity.uid))));
});

router.put("/investor/update-emails", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const identity = await resolveProtectedIdentity(req, res, true);
  if (!identity) return;
  const body = SetInvestorUpdateEmailsBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Choose on or off." }); return; }
  const investorId = await investorIdFor(identity.provider, identity.uid);
  if (!investorId) { res.status(404).json({ error: "There’s no pledge on this account yet." }); return; }
  await pool.query(
    "insert into project_update_email_events (investor_id, allowed, source) values ($1, $2, 'lineup')",
    [investorId, body.data.enabled],
  );
  res.json(SetInvestorUpdateEmailsResponse.parse(await preferenceView(investorId)));
});

export default router;
