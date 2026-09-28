import { Router, type IRouter } from "express";
import { db, filmmakersTable, getCompletedFilmmakerResult, getFilmmakerAccountProjectVisitor, projectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { authenticateFilmmaker, authorizeFilmmakerVisitor, requireMatchingFilmmakerContext } from "../lib/filmmaker-auth";
import { reconcileReviewCheckouts, startReviewCheckout } from "../lib/pitch-review-payments";
import { verifyPitchReviewProof } from "../lib/pitch-review-proof";

const router: IRouter = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function currentPitch(req: Parameters<typeof authorizeFilmmakerVisitor>[0], res: Parameters<typeof authorizeFilmmakerVisitor>[1]) {
  const cookieId = req.cookies?.msi_visitor_id;
  const projectHeader = req.get("X-MSI-Project-Id");
  const projectId = projectHeader && /^[1-9]\d*$/.test(projectHeader) ? Number(projectHeader) : null;
  if (projectHeader && (!projectId || !Number.isSafeInteger(projectId))) {
    res.status(400).json({ error: "Choose a valid completed pitch before starting checkout." });
    return null;
  }
  let visitorId: string | null = null;
  if (projectId && verifyPitchReviewProof(req.get("X-MSI-Checkout-Proof"), projectId)) {
    const [owner] = await db.select({ visitorId: filmmakersTable.visitorId })
      .from(projectsTable)
      .innerJoin(filmmakersTable, eq(projectsTable.filmmakerId, filmmakersTable.id))
      .where(eq(projectsTable.id, projectId))
      .limit(1);
    visitorId = owner?.visitorId ?? null;
  }
  if (!visitorId && projectId && (req.get("authorization") || req.isAuthenticated?.())) {
    const identity = await authenticateFilmmaker(req, res, false);
    if (!identity) return null;
    visitorId = await getFilmmakerAccountProjectVisitor(identity.uid, projectId, identity.provider);
  }
  visitorId ??= typeof cookieId === "string" && UUID.test(cookieId) ? cookieId : null;
  if (!visitorId) {
    res.status(400).json({ error: "This browser no longer has the visit that submitted the pitch. Sign in and open your pitch from My projects, or return to the original browser." });
    return null;
  }
  const access = await authorizeFilmmakerVisitor(req, res, visitorId);
  if (!access.allowed) return null;
  const result = await getCompletedFilmmakerResult(visitorId);
  if (!result?.project) {
    res.status(404).json({ error: "No completed pitch is selected." });
    return null;
  }
  if (projectId && result.project.id !== projectId) {
    res.status(409).json({ error: "The selected pitch changed. Open My projects and select it again." });
    return null;
  }
  if (access.identity && !requireMatchingFilmmakerContext(req, res, "X-MSI-Project-Id", result.project.id, "project")) return null;
  return { visitorId, project: result.project };
}

router.post("/filmmakers/review-checkout", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const context = await currentPitch(req, res);
  if (!context) return;
  const { project, visitorId } = context;
  if (project.hidden || !project.slug) {
    res.status(409).json({ error: "This pitch cannot be submitted for review." });
    return;
  }
  try {
    await reconcileReviewCheckouts(project.id);
  } catch (error) {
    req.log.error({ error }, "Could not verify previous checkout");
    res.status(503).json({ error: "Payment verification is unavailable. Please retry later; do not pay twice." });
    return;
  }
  const latest = await getCompletedFilmmakerResult(visitorId);
  if (latest?.project?.reviewPaidAt) {
    res.json({ url: null, already_submitted: true });
    return;
  }
  if (project.reviewPaidAt || project.showcaseRequested || project.approved) {
    res.json({ url: null, already_submitted: true });
    return;
  }
  try {
    const url = await startReviewCheckout(project.id, visitorId);
    res.json({ url, already_submitted: false });
  } catch (error) {
    req.log.error({ error }, "Could not create sandbox review checkout");
    res.status(503).json({ error: "Test checkout is temporarily unavailable. Your free pitch is still saved." });
  }
});

router.get("/filmmakers/review-checkout/status", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const context = await currentPitch(req, res);
  if (!context) return;
  try {
    await reconcileReviewCheckouts(context.project.id);
  } catch (error) {
    req.log.error({ error }, "Could not verify sandbox review payment");
    res.status(503).json({ error: "We could not verify your payment yet. Please try again; do not pay twice." });
    return;
  }
  const refreshed = await getCompletedFilmmakerResult(context.visitorId);
  const project = refreshed?.project;
  if (!project || project.id !== context.project.id) {
    res.status(409).json({ error: "The selected pitch changed. Open My projects and select it again." });
    return;
  }
  res.json({
    paid: Boolean(project.reviewPaidAt),
    pending: Boolean(project.showcaseRequested && !project.approved && project.reviewDecision !== "declined"),
    approved: Boolean(project.approved && project.showcaseRequested),
    declined: project.reviewDecision === "declined",
  });
});

export default router;