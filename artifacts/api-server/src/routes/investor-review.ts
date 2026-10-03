import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import {
  GetAdminInvestorsQueryParams, ExportAdminInvestorsQueryParams,
  GetAdminInvestorsResponse, GetAdminInvestorResponse,
  GetInvestorNotificationPermissionResponse, SetInvestorNotificationPermissionBody,
  SaveAdminReviewNotesBody,
} from "@workspace/api-zod";
import { authorizeAdminIdentity } from "../lib/admin-auth";
import { resolveProtectedIdentity } from "../lib/filmmaker-auth";
import { csvCell, filterInvestorRecords, loadInvestorReview, notificationHistory, NOTIFICATION_VERSION, reviewAnswers } from "../lib/investor-review";

const router: IRouter = Router();
router.use((_req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); });

router.get("/investor/notification-permission", async (req, res) => {
  const identity = await resolveProtectedIdentity(req, res, true);
  if (!identity) return;
  const latest = (await notificationHistory(identity))[0];
  res.json(GetInvestorNotificationPermissionResponse.parse(latest ?? { allowed: null, recorded_at: null, version: NOTIFICATION_VERSION }));
});
router.put("/investor/notification-permission", async (req, res) => {
  const identity = await resolveProtectedIdentity(req, res, true);
  if (!identity) return;
  const body = SetInvestorNotificationPermissionBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Choose whether you want offering notifications." }); return; }
  if (body.data.expected_owner !== `${identity.provider}:${identity.uid}`) {
    res.status(409).json({ error: "The signed-in account changed. Reload before changing notification permission." }); return;
  }
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`notifications:${identity.provider}:${identity.uid}`]);
    // Legacy members may return directly to their lineup, without opening a new worksheet.
    // Record the currently verified outreach destination without rewriting their saved answers.
    await client.query(
      `insert into investor_account_progress
       (provider,uid,last_screen,answers,completed,first_seen_at,verified_email,email_verified_at)
       values ($1,$2,1,'{}'::jsonb,false,null,$3,now())
       on conflict (provider,uid) do update set verified_email=excluded.verified_email,
       email_verified_at=excluded.email_verified_at`,
      [identity.provider, identity.uid, identity.email],
    );
    const latest = await client.query("select allowed, recorded_at, version from investor_notification_events where provider=$1 and uid=$2 order by id desc limit 1", [identity.provider, identity.uid]);
    let result = latest.rows[0];
    if (!result || result.allowed !== body.data.allowed || result.version !== NOTIFICATION_VERSION) {
      const inserted = await client.query(
        "insert into investor_notification_events(provider,uid,allowed,version) values($1,$2,$3,$4) returning allowed,recorded_at,version",
        [identity.provider, identity.uid, body.data.allowed, NOTIFICATION_VERSION],
      );
      result = inserted.rows[0];
    }
    await client.query("commit");
    res.json(GetInvestorNotificationPermissionResponse.parse({ ...result, recorded_at: result.recorded_at.toISOString() }));
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
});

router.get("/admin/investors", async (req, res) => {
  if (!await authorizeAdminIdentity(req, res)) return;
  const query = GetAdminInvestorsQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: "Invalid investor filters." }); return; }
  const data = await loadInvestorReview();
  const records = filterInvestorRecords(data.records, query.data);
  const offset = query.data.offset ?? 0; const limit = query.data.limit ?? 50;
  res.json(GetAdminInvestorsResponse.parse({ items: records.slice(offset, offset + limit).map(record => record.summary), total: records.length, projects: data.projects }));
});

router.get("/admin/investors/export", async (req, res) => {
  if (!await authorizeAdminIdentity(req, res)) return;
  const query = ExportAdminInvestorsQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: "Invalid investor filters." }); return; }
  const data = await loadInvestorReview();
  const records = filterInvestorRecords(data.records, query.data);
  const rows: unknown[][] = [["Name", "Email", "Phone", "City", "Region", "Country", "Segment", "Project status", "Non-binding amount", "Latest confirmation", "Notification permission", "Permission recorded"]];
  for (const record of records) {
    if (!record.row || record.summary.status !== "confirmed" || record.summary.notification_allowed !== true) continue;
    const profile = record.row;
    // Export only the verified account destination; a historical typed email is not evidence of ownership.
    const email = record.draft?.verified_email;
    if (!email) continue;
    const latestPermission = (await notificationHistory(record.account))[0];
    if (latestPermission?.allowed !== true) continue;
    const segments = new Map<string, { amount: number; latest: string; title: string; eligible: boolean | null }>();
    const confirmed = [
      ...(profile.confirmed_at ? [{ id: null, amount: Number(profile.investment_amount ?? profile.amount_choice), unallocated: profile.unallocated, confirmed_at: profile.confirmed_at }] : []),
      ...data.entries.filter(entry => entry.investor_id === profile.id && entry.confirmed_at),
    ];
    for (const entry of confirmed) {
      const add = (key: string, amount: number, title: string, eligible: boolean | null) => {
        const timestamp = new Date(entry.confirmed_at).toISOString();
        const old = segments.get(key);
        segments.set(key, { amount: (old?.amount ?? 0) + amount, latest: old && old.latest > timestamp ? old.latest : timestamp, title, eligible });
      };
      if (entry.unallocated) add("general", Number(entry.amount), "General interest (unallocated)", null);
      else for (const pledge of data.pledges.filter(p => p.investor_id === profile.id && p.confirmed && (p.entry_id ?? null) === entry.id)) {
        const project = data.projectMap.get(Number(pledge.project_id));
        if (!project) { add("removed", Number(pledge.amount), "Previously selected project removed", false); continue; }
        add(String(project.id), Number(pledge.amount), String(project.title ?? "Untitled project"), Boolean(project.approved && project.showcase_requested && !project.hidden));
      }
    }
    for (const [key, segment] of segments) {
      if (query.data.project_id && key !== String(query.data.project_id)) continue;
      rows.push([profile.name, email, profile.phone, profile.city, profile.state, profile.country, segment.title,
        segment.eligible === null ? "General interest" : segment.eligible ? "Currently eligible" : "Not currently eligible; historic interest only",
        segment.amount, segment.latest, "Explicit permission", latestPermission?.recorded_at]);
    }
  }
  res.set("Content-Type", "text/csv; charset=utf-8").set("Content-Disposition", 'attachment; filename="investor-outreach-waitlist.csv"');
  res.send("\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n"));
});

router.get("/admin/investors/:recordId", async (req, res) => {
  if (!await authorizeAdminIdentity(req, res)) return;
  if (!/^(investor|account):[1-9]\d*$/.test(String(req.params.recordId))) { res.status(400).json({ error: "Invalid investor record." }); return; }
  const data = await loadInvestorReview();
  const record = data.records.find(item => item.summary.id === req.params.recordId);
  if (!record) { res.status(404).json({ error: "Investor record not found." }); return; }
  const account = record.account;
  const age = account ? await pool.query("select confirmed_at from age_confirmations where provider=$1 and uid=$2", [account.provider, account.uid]) : { rows: [] };
  const row = record.row;
  const entryRows = row ? [
    { id: null, name: row.name, amount: Number(row.investment_amount ?? row.amount_choice), unallocated: row.unallocated, signature_name: row.signature_name, confirmed_at: row.confirmed_at, submitted_answers: row.submitted_answers, confirmation_evidence: row.confirmation_evidence },
    ...data.entries.filter(entry => entry.investor_id === row.id),
  ] : [];
  const entries = entryRows.map(entry => ({
    entry_id: entry.id, name: entry.name, amount: entry.amount, unallocated: entry.unallocated,
    signature_name: entry.signature_name ?? null, confirmed_at: entry.confirmed_at ?? null,
    submitted_answers: entry.submitted_answers ?? null, confirmation_evidence: entry.confirmation_evidence ?? null,
    evidence_status: entry.confirmation_evidence ? "Preserved exact confirmation evidence" : "Historical full acknowledgment/terms evidence unavailable",
    allocations: data.pledges.filter(p => p.investor_id === row?.id && (p.entry_id ?? null) === entry.id).map(p => {
      const project = data.projectMap.get(Number(p.project_id));
      return { project_id: p.project_id, title: project?.title ?? "Project removed", amount: p.amount,
        confirmed: p.confirmed, eligible: Boolean(project?.approved && project?.showcase_requested && !project?.hidden) };
    }),
  }));
  res.json(GetAdminInvestorResponse.parse({
    id: record.summary.id,
    profile: row ? reviewAnswers(row) : { name: record.summary.name, email: record.summary.email, status: record.summary.status },
    draft: record.draft ? { last_screen: record.draft.last_screen, answers: reviewAnswers((record.draft.answers ?? {}) as Record<string, unknown>), completed: record.draft.completed, updated_at: record.draft.updated_at, first_seen_at: record.draft.first_seen_at } : null,
    entries,
    verification: {
      account_authenticated: Boolean(account),
      verified_account_email: record.draft?.verified_email ?? null,
      email_verified_at: record.draft?.email_verified_at ?? null,
      contact_email_matches_verified_account: record.draft?.verified_email && row?.email ? String(record.draft.verified_email).toLowerCase() === String(row.email).toLowerCase() : null,
      phone: "Self-reported; not verified here",
      accreditation: "Self-reported; not verified",
      legal_identity: "Not verified by this intake",
      investment_eligibility: "Not assessed; interest is non-binding",
    },
    age_confirmation: age.rows[0] ? { ...age.rows[0], self_declaration: true, identity_or_date_of_birth_verified: false } : null,
    notification_history: await notificationHistory(account),
  }));
});

router.put("/admin/projects/:projectId/review-notes", async (req, res) => {
  if (!await authorizeAdminIdentity(req, res)) return;
  const id = Number(req.params.projectId);
  const parsed = SaveAdminReviewNotesBody.safeParse(req.body);
  if (!Number.isSafeInteger(id) || id < 1 || !parsed.success) { res.status(400).json({ error: "Invalid review notes." }); return; }
  const saved = { ...parsed.data, updated_at: new Date().toISOString() };
  const result = await pool.query(
    `update projects set review_notes=$1::jsonb,
     review_history=coalesce(review_history,'[]'::jsonb) || $2::jsonb
     where id=$3 and coalesce(review_notes->>'updated_at','')=$4 returning id`,
    [JSON.stringify(saved), JSON.stringify([{ action: "Manual review notes saved", ...saved }]), id, parsed.data.updated_at ?? ""],
  );
  if (!result.rows.length) {
    const exists = await pool.query("select id from projects where id=$1", [id]);
    res.status(exists.rows.length ? 409 : 404).json({ error: exists.rows.length ? "Review notes changed. Reload the pitch before saving your notes." : "Pitch not found." }); return;
  }
  res.json(saved);
});
export default router;