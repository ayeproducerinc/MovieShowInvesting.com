import { randomInt, randomUUID } from "node:crypto";
import cookieParser from "cookie-parser";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  pool,
  assignVisitorPriceGroup,
  ensureVisitor,
  findVisitorFlowProgress,
  readVisitorPriceGroup,
  saveVisitorFlowProgress,
  visitorExists,
} from "@workspace/db";
import {
  GetFlowProgressParams,
  GetFlowProgressResponse,
  GetPriceGroupResponse,
  SaveFlowProgressBody,
  SaveFlowProgressResponse,
} from "@workspace/api-zod";
import {
  authorizeFilmmakerVisitor,
  resolveProtectedIdentity,
  requireMatchingFilmmakerContext,
} from "../lib/filmmaker-auth";

const router: IRouter = Router();
router.use(cookieParser());

const VISITOR_COOKIE = "msi_visitor_id";
const ONE_YEAR = 365 * 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type InvestorVisitorRow = {
  visitor_id: string | null;
  firebase_uid: string | null;
  replit_uid: string | null;
};
type AccountProgressRow = {
  last_screen: number;
  answers: Record<string, unknown>;
  completed: boolean;
  updated_at: Date;
};

function setVisitorCookie(req: Request, res: Response, visitorId: string): void {
  res.cookie(VISITOR_COOKIE, visitorId, {
    maxAge: ONE_YEAR,
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure,
    path: "/",
  });
}

router.get("/price-group", async (req, res): Promise<void> => {
  const candidate = req.cookies?.[VISITOR_COOKIE];
  const visitorId = typeof candidate === "string" && UUID.test(candidate) ? candidate : randomUUID();
  setVisitorCookie(req, res, visitorId);
  await ensureVisitor(visitorId);

  const group = await readVisitorPriceGroup(visitorId);
  if (group) {
    res.json(GetPriceGroupResponse.parse({ group }));
    return;
  }

  const chosenGroup = randomInt(0, 2) === 0 ? "A" : "B";
  const assigned = await assignVisitorPriceGroup(visitorId, chosenGroup);
  const winner = assigned ?? await readVisitorPriceGroup(visitorId);
  if (!winner) {
    res.status(500).json({ error: "Could not assign a price group." });
    return;
  }
  res.json(GetPriceGroupResponse.parse({ group: winner }));
});

router.get("/progress/:flow", async (req, res): Promise<void> => {
  const parsedParams = GetFlowProgressParams.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: "Invalid flow." });
    return;
  }
  if (parsedParams.data.flow === "investor") {
    const identity = await resolveProtectedIdentity(req, res, true);
    if (!identity) return;
    const { rows } = await pool.query<AccountProgressRow>(
      "select last_screen, answers, completed, updated_at from investor_account_progress where provider = $1 and uid = $2",
      [identity.provider, identity.uid],
    );
    let record: AccountProgressRow | undefined = rows[0];
    if (!record) {
      // Only a record already linked to this exact verified identity may
      // supply legacy visitor progress. An unclaimed guest draft never can.
      const uidColumn = identity.provider === "firebase" ? "firebase_uid" : "replit_uid";
      const owner = await pool.query<InvestorVisitorRow>(
        `select visitor_id, firebase_uid, replit_uid from investors where ${uidColumn} = $1 order by id limit 2`,
        [identity.uid],
      );
      if (owner.rows.length > 1) {
        res.status(409).json({ error: "This account has conflicting investor records." });
        return;
      }
      if (owner.rows[0]?.visitor_id) {
        const legacy = await findVisitorFlowProgress(owner.rows[0].visitor_id, "investor");
        if (legacy) record = {
          last_screen: legacy.lastScreen,
          answers: legacy.answers as Record<string, unknown>,
          completed: legacy.completed,
          updated_at: new Date(legacy.updatedAt),
        };
      }
    }
    // Preserve securely linked legacy progress before registering the investor-specific start.
    await pool.query(
      `insert into investor_account_progress
       (provider, uid, last_screen, answers, completed, first_seen_at, verified_email, email_verified_at)
       values ($1,$2,$3,$4::jsonb,$5,$6,$7,now())
       on conflict (provider, uid) do update set verified_email=excluded.verified_email,
       email_verified_at=excluded.email_verified_at`,
      [identity.provider, identity.uid, record?.last_screen ?? 1, JSON.stringify(record?.answers ?? {}),
        record?.completed ?? false, record ? null : new Date(), identity.email],
    );
    if (!record) {
      res.status(404).json({ error: "No progress saved." });
      return;
    }
    res.json(GetFlowProgressResponse.parse({
      flow: "investor", last_screen: record.last_screen,
      answers: record.answers, completed: record.completed,
      updated_at: record.updated_at.toISOString(),
    }));
    return;
  }

  const cookieCandidate = req.cookies?.[VISITOR_COOKIE];
  const cookieId = typeof cookieCandidate === "string" && UUID.test(cookieCandidate) ? cookieCandidate : null;
  let visitorId = cookieId;
  if (!visitorId) {
    res.status(404).json({ error: "No progress saved." });
    return;
  }
  if (parsedParams.data.flow === "filmmaker") {
    const access = await authorizeFilmmakerVisitor(req, res, visitorId);
    if (!access.allowed) return;
  }

  const record = await findVisitorFlowProgress(visitorId, parsedParams.data.flow);
  if (!record) {
    res.status(404).json({ error: "No progress saved." });
    return;
  }

  res.json(GetFlowProgressResponse.parse({
    flow: record.flow,
    ...(record.flow === "filmmaker" ? { draft_id: record.id } : {}),
    last_screen: record.lastScreen,
    answers: record.answers,
    completed: record.completed,
    updated_at: record.updatedAt,
  }));
});

router.post("/progress", async (req, res): Promise<void> => {
  const parsed = SaveFlowProgressBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid progress input." });
    return;
  }
  if (parsed.data.flow === "filmmaker" && parsed.data.completed === true) {
    res.status(400).json({ error: "Filmmaker progress is completed only by final submission." });
    return;
  }
  const screenLimit = parsed.data.flow === "filmmaker" ? 6 : 5;
  if (parsed.data.last_screen > screenLimit) {
    res.status(400).json({ error: `Screen must be between 1 and ${screenLimit} for this flow.` });
    return;
  }
  if (parsed.data.flow === "investor") {
    const identity = await resolveProtectedIdentity(req, res, true);
    if (!identity) return;
    const actualOwner = `${identity.provider}:${identity.uid}`;
    if (parsed.data.expected_investor_owner !== actualOwner) {
      res.status(409).json({ error: "The investor account changed while this worksheet was open. Reload before saving." });
      return;
    }
    const { rows } = await pool.query<AccountProgressRow>(
      `insert into investor_account_progress (provider, uid, last_screen, answers, completed, first_seen_at, verified_email, email_verified_at)
       values ($1, $2, $3, $4::jsonb, $5, now(), $6, now())
       on conflict (provider, uid) do update set
         last_screen = excluded.last_screen, answers = excluded.answers,
         completed = excluded.completed, updated_at = now(),
         verified_email = excluded.verified_email, email_verified_at = excluded.email_verified_at
       returning last_screen, answers, completed, updated_at`,
      [identity.provider, identity.uid, parsed.data.last_screen,
        JSON.stringify(parsed.data.answers), parsed.data.completed ?? false, identity.email],
    );
    const record = rows[0];
    res.json(SaveFlowProgressResponse.parse({
      flow: "investor", last_screen: record.last_screen,
      answers: record.answers, completed: record.completed,
      updated_at: record.updated_at.toISOString(),
    }));
    return;
  }

  const cookieCandidate = req.cookies?.[VISITOR_COOKIE];
  const cookieId = typeof cookieCandidate === "string" && UUID.test(cookieCandidate) ? cookieCandidate : null;
  let visitorId = cookieId;
  if (!visitorId) {
    res.status(400).json({ error: "A visitor cookie is required before saving progress." });
    return;
  }
  if (parsed.data.flow === "filmmaker") {
    const access = await authorizeFilmmakerVisitor(req, res, visitorId);
    if (!access.allowed) return;
    if (access.identity) {
      const draft = await findVisitorFlowProgress(visitorId, "filmmaker");
      if (!draft) {
        res.status(409).json({ error: "No current filmmaker draft was found for this visitor." });
        return;
      }
      if (!requireMatchingFilmmakerContext(req, res, "X-MSI-Draft-Id", draft.id, "draft")) return;
    }
  }

  if (!await visitorExists(visitorId)) {
    res.status(400).json({ error: "Visitor must be recorded before saving progress." });
    return;
  }

  const record = await saveVisitorFlowProgress({
    visitorId,
    flow: parsed.data.flow,
    lastScreen: parsed.data.last_screen,
    answers: parsed.data.answers,
    completed: parsed.data.completed ?? false,
  });

  res.json(SaveFlowProgressResponse.parse({
    flow: record.flow,
    last_screen: record.lastScreen,
    answers: record.answers,
    completed: record.completed,
    updated_at: record.updatedAt,
  }));
});

export default router;