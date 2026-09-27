import cookieParser from "cookie-parser";
import { Router, type IRouter } from "express";
import {
  createFilmmakerSubmission,
  FilmmakerSubmissionError,
  type FilmmakerSubmissionData,
} from "@workspace/db";
import {
  SubmitFilmmakerBody,
  SubmitFilmmakerResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();
router.use(cookieParser());

const VISITOR_COOKIE = "msi_visitor_id";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INPUT_FIELDS = new Set([
  "no_project_yet", "stage", "stage_other", "title", "format", "genre", "genre_other",
  "logline", "trailer_url", "pilot_url", "budget", "budget_from_example", "deal_answer",
  "offer_per100", "offer_other_text", "wants_lower", "payback_terms", "payback_terms_other",
  "funding_sources", "funding_other", "reached_goal", "funding_experience", "name", "email",
  "city", "state", "country", "favorite_genres", "chat_opt_in", "phone",
]);

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

router.post("/filmmakers", async (req, res): Promise<void> => {
  if (req.body === null || typeof req.body !== "object" || Array.isArray(req.body)
    || Object.keys(req.body).some((key) => !INPUT_FIELDS.has(key))) {
    res.status(400).json({ error: "Invalid filmmaker submission." });
    return;
  }

  const parsed = SubmitFilmmakerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid filmmaker submission." });
    return;
  }

  const cookieId = req.cookies?.[VISITOR_COOKIE];
  if (typeof cookieId !== "string" || !UUID.test(cookieId)) {
    res.status(400).json({ error: "A recorded visitor cookie is required to submit." });
    return;
  }

  const data = parsed.data;
  if (!data.no_project_yet) {
    const requiredProjectValues: Array<[string, unknown]> = [
      ["stage", data.stage],
      ["title", data.title],
      ["format", data.format],
      ["genre", data.genre],
      ["logline", data.logline],
      ["budget", data.budget],
      ["budget_from_example", data.budget_from_example],
      ["deal_answer", data.deal_answer],
      ["offer_per100", data.offer_per100],
      ["wants_lower", data.wants_lower],
      ["payback_terms", data.payback_terms],
      ["funding_sources", data.funding_sources],
      ["reached_goal", data.reached_goal],
      ["funding_experience", data.funding_experience],
    ];
    if (requiredProjectValues.some(([, value]) => value === undefined)
      || !hasText(data.title)
      || !hasText(data.logline)
      || (data.stage === "other" && !hasText(data.stage_other))
      || (data.genre === "Other" && !hasText(data.genre_other))
      || (data.payback_terms === "other" && !hasText(data.payback_terms_other))) {
      res.status(400).json({ error: "Project, offer, and funding details are required for project submissions." });
      return;
    }
  }

  try {
    const result = await createFilmmakerSubmission({
      visitorId: cookieId,
      data: data as FilmmakerSubmissionData,
    });
    res.status(201).json(SubmitFilmmakerResponse.parse({
      filmmaker_id: result.filmmakerId,
      project_id: result.projectId,
    }));
  } catch (error) {
    if (error instanceof FilmmakerSubmissionError) {
      res.status(400).json({ error: error.message });
      return;
    }
    throw error;
  }
});

export default router;