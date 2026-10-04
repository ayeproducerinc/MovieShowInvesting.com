import { Router, type IRouter } from "express";
import cookieParser from "cookie-parser";
import {
  pool, DraftResetConflict, inspectDraftReset, resetOwnDrafts, inspectAllDrafts, clearDraftAllowlist,
  getFilmmakerAccountVisitorOwner,
} from "@workspace/db";
import {
  ResetFilmmakerDraftsBody, CleanupUnfinishedDraftsBody,
  InspectFilmmakerDraftResetResponse, ResetFilmmakerDraftsResponse, CleanupUnfinishedDraftsResponse,
} from "@workspace/api-zod";
import { authenticateFilmmaker } from "../lib/filmmaker-auth";
import { authorizeAdminIdentity } from "../lib/admin-auth";

const router: IRouter = Router();
router.use(cookieParser());
const visitorId = (req: { cookies?: Record<string, unknown> }) => {
  const value = req.cookies?.msi_visitor_id;
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
};
router.all("/filmmakers/drafts/reset", async (req, res, next): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const identity = await authenticateFilmmaker(req, res, false);
  if (res.headersSent) return;
  const visitor = visitorId(req);
  const draftHeader = req.get("X-MSI-Draft-Id");
  if (draftHeader !== undefined && (!/^[1-9]\d*$/.test(draftHeader) || !Number.isSafeInteger(Number(draftHeader)))) {
    res.status(400).json({ error: "Invalid draft context." }); return;
  }
  const expectedDraftId = draftHeader ? Number(draftHeader) : undefined;
  // Also check ownership when no progress/material row remains after cleanup.
  const owner = visitor ? await getFilmmakerAccountVisitorOwner(visitor) : null;
  if (owner && (owner.provider !== identity?.provider || owner.uid !== identity?.uid)) {
    res.status(403).json({ error: "Sign in with this draft’s owner before starting over." }); return;
  }
  try {
    if (req.method === "GET") {
      res.json(InspectFilmmakerDraftResetResponse.parse(await inspectDraftReset(pool, visitor, identity, expectedDraftId)));
    } else if (req.method === "POST") {
      const body = ResetFilmmakerDraftsBody.safeParse(req.body);
      if (!body.success) { res.status(400).json({ error: "Explicit confirmation and the exact draft preview are required." }); return; }
      const result = await resetOwnDrafts(pool, { ...body.data, visitor, identity, expectedDraftId });
      res.cookie("msi_visitor_id", result.visitor, {
        maxAge: 365 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: "lax", secure: req.secure, path: "/",
      });
      res.json(ResetFilmmakerDraftsResponse.parse({ cleared: result.cleared }));
    } else { next(); }
  } catch (error) {
    if (!(error instanceof DraftResetConflict)) throw error;
    res.status(409).json({ error: error.message });
  }
});
router.post("/admin/unfinished-draft-cleanup", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  if (!await authorizeAdminIdentity(req, res)) return;
  const body = CleanupUnfinishedDraftsBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "A valid environment and cleanup request are required." }); return; }
  const environment = process.env.NODE_ENV === "production" ? "published" : "preview";
  if (body.data.environment !== environment) { res.status(409).json({ error: "Wrong server environment. Nothing was deleted." }); return; }
  if (!body.data.dry_run && (body.data.confirmation !== "CLEAR ALL UNFINISHED FILMMAKER DRAFTS" || !body.data.drafts)) {
    res.status(400).json({ error: "Explicit sitewide confirmation and a frozen draft allowlist are required." }); return;
  }
  if (body.data.drafts && new Set(body.data.drafts.map(draft => draft.key)).size !== body.data.drafts.length) {
    res.status(400).json({ error: "The allowlist must contain unique drafts." }); return;
  }
  const result = body.data.dry_run ? { cleared: 0, skipped: 0 } : await clearDraftAllowlist(pool, body.data.drafts!);
  const remaining = await inspectAllDrafts(pool);
  req.log.info({ environment, dryRun: body.data.dry_run, cleared: result.cleared, skipped: result.skipped }, "Unfinished filmmaker draft cleanup");
  res.json(CleanupUnfinishedDraftsResponse.parse({ ...remaining, ...result }));
});
export default router;