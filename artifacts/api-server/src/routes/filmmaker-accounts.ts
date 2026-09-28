import { randomUUID } from "node:crypto";
import cookieParser from "cookie-parser";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  FilmmakerAccountError,
  claimFilmmakerVisitor,
  ensureVisitor,
  getFilmmakerAccountProjectVisitor,
  getFilmmakerAccountVisitorOwner,
  listFilmmakerAccountProjects,
  resumeFilmmakerAccountDraft,
  startOrResumeFilmmakerAccountDraft,
} from "@workspace/db";
import {
  ClaimFilmmakerProjectResponse,
  LeaveFilmmakerAccountResponse,
  GetFilmmakerProjectsResponse,
  ResumeFilmmakerProjectResponse,
  SelectFilmmakerProjectParams,
  SelectFilmmakerProjectResponse,
  StartFilmmakerProjectResponse,
} from "@workspace/api-zod";
import { authenticateFilmmaker } from "../lib/filmmaker-auth";

const router: IRouter = Router();
router.use(cookieParser());

const VISITOR_COOKIE = "msi_visitor_id";
const ONE_YEAR = 365 * 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readVisitorCookie(req: Request): string | null {
  const id = req.cookies?.[VISITOR_COOKIE];
  return typeof id === "string" && UUID.test(id) ? id : null;
}

function setVisitorCookie(req: Request, res: Response, visitorId: string): void {
  res.cookie(VISITOR_COOKIE, visitorId, {
    maxAge: ONE_YEAR,
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure,
    path: "/",
  });
}

function accountError(res: Response, error: unknown, action: "claim" | "start"): boolean {
  if (!(error instanceof FilmmakerAccountError)) return false;
  switch (error.code) {
    case "visitor_not_found":
    case "submission_not_found":
      res.status(404).json({ error: error.message });
      return true;
    case "verified_email_mismatch":
    case "visitor_owned_by_another_account":
      res.status(403).json({ error: error.message });
      return true;
    case "completed_submission_unclaimed":
    case "account_draft_conflict":
      res.status(409).json({ error: error.message });
      return true;
    case "draft_not_found":
    case "project_not_found":
      res.status(404).json({ error: error.message });
      return true;
    default:
      if (action === "start") {
        res.status(400).json({ error: error.message });
        return true;
      }
      return false;
  }
}

router.get("/filmmakers/projects", async (req, res): Promise<void> => {
  const identity = await authenticateFilmmaker(req, res, true);
  if (!identity) return;
  const result = await listFilmmakerAccountProjects(identity.uid, identity.provider);
  res.json(GetFilmmakerProjectsResponse.parse({
    projects: result.projects.map((project) => ({
      id: project.id,
      slug: project.slug,
      title: project.title,
      review_state: project.reviewState,
      created_at: project.createdAt,
    })),
    has_resumable_draft: result.hasResumableDraft,
    phone_verified: result.phoneVerified,
  }));
});

router.post("/filmmakers/projects/claim", async (req, res): Promise<void> => {
  const identity = await authenticateFilmmaker(req, res, true);
  if (!identity) return;
  const visitorId = readVisitorCookie(req);
  if (!visitorId) {
    res.status(400).json({ error: "A recorded visitor cookie is required to claim a project." });
    return;
  }
  try {
    const result = await claimFilmmakerVisitor({
      visitorId,
      ...(identity.provider === "firebase" ? { firebaseUid: identity.uid } : { replitUid: identity.uid }),
      verifiedEmail: identity.email,
    });
    res.json(ClaimFilmmakerProjectResponse.parse({
      claimed: true,
      submission_claimed: result.submissionClaimed,
      project_id: result.projectId,
    }));
  } catch (error) {
    if (accountError(res, error, "claim")) return;
    throw error;
  }
});

router.post("/filmmakers/projects/start", async (req, res): Promise<void> => {
  const identity = await authenticateFilmmaker(req, res, true);
  if (!identity) return;
  const currentVisitorId = readVisitorCookie(req);
  try {
    const draft = await startOrResumeFilmmakerAccountDraft({
      ...(identity.provider === "firebase" ? { firebaseUid: identity.uid } : { replitUid: identity.uid }),
      currentVisitorId,
    });
    setVisitorCookie(req, res, draft.visitorId);
    res.json(StartFilmmakerProjectResponse.parse({
      status: draft.status,
      last_screen: draft.lastScreen,
      updated_at: draft.updatedAt,
    }));
  } catch (error) {
    if (accountError(res, error, "start")) return;
    throw error;
  }
});

router.post("/filmmakers/projects/resume", async (req, res): Promise<void> => {
  const identity = await authenticateFilmmaker(req, res, true);
  if (!identity) return;
  const draft = await resumeFilmmakerAccountDraft(identity.uid, identity.provider);
  if (!draft) {
    res.status(404).json({ error: "No resumable filmmaker draft was found." });
    return;
  }
  setVisitorCookie(req, res, draft.visitorId);
  res.json(ResumeFilmmakerProjectResponse.parse({
    status: "resumed",
    last_screen: draft.lastScreen,
    updated_at: draft.updatedAt,
  }));
});

router.post("/filmmakers/projects/leave", async (req, res): Promise<void> => {
  const identity = await authenticateFilmmaker(req, res, true);
  if (!identity) return;
  const currentVisitorId = readVisitorCookie(req);
  const owner = currentVisitorId ? await getFilmmakerAccountVisitorOwner(currentVisitorId) : null;
  const shouldRotate = owner?.provider === identity.provider && owner.uid === identity.uid;
  if (shouldRotate) {
    const visitorId = randomUUID();
    await ensureVisitor(visitorId);
    setVisitorCookie(req, res, visitorId);
  }
  res.json(LeaveFilmmakerAccountResponse.parse({ visitor_cookie_rotated: shouldRotate }));
});

router.post("/filmmakers/projects/:project_id/select", async (req, res): Promise<void> => {
  const params = SelectFilmmakerProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid project ID." });
    return;
  }
  const identity = await authenticateFilmmaker(req, res, true);
  if (!identity) return;
  const visitorId = await getFilmmakerAccountProjectVisitor(identity.uid, params.data.project_id, identity.provider);
  if (!visitorId) {
    res.status(404).json({ error: "Project is not available to this filmmaker account." });
    return;
  }
  setVisitorCookie(req, res, visitorId);
  res.json(SelectFilmmakerProjectResponse.parse({ project_id: params.data.project_id }));
});

export default router;