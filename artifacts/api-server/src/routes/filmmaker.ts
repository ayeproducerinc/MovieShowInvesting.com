import cookieParser from "cookie-parser";
import { Router, type IRouter } from "express";
import {
  createFilmmakerSubmission,
  FilmmakerSubmissionError,
  getCompletedFilmmakerResult,
  updateOwnedFilmmakerShowcase,
  type FilmmakerSubmissionData,
} from "@workspace/db";
import {
  SubmitFilmmakerBody,
  SubmitFilmmakerResponse,
  GetFilmmakerResultResponse,
  UpdateFilmmakerShowcaseBody,
  UpdateFilmmakerShowcaseResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();
router.use(cookieParser());

const VISITOR_COOKIE = "msi_visitor_id";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHOWCASE_FIELDS = new Set([
  "showcase_requested", "synopsis", "team_links", "money_use", "distribution_plan", "trailer_url",
]);
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

router.get("/filmmakers/result", async (req, res): Promise<void> => {
  const cookieId = req.cookies?.[VISITOR_COOKIE];
  if (typeof cookieId !== "string" || !UUID.test(cookieId)) {
    res.status(404).json({ error: "No completed filmmaker submission was found." });
    return;
  }
  const result = await getCompletedFilmmakerResult(cookieId);
  if (!result) {
    res.status(404).json({ error: "No completed filmmaker submission was found." });
    return;
  }
  const answers = result.answers;
  const stringAnswer = (field: string): string | null =>
    typeof answers[field] === "string" ? answers[field] as string : null;
  const numberAnswer = (field: string): number | null =>
    typeof answers[field] === "number" ? answers[field] as number : null;
  const booleanAnswer = (field: string): boolean | null =>
    typeof answers[field] === "boolean" ? answers[field] as boolean : null;
  const project = result.project;
  const response = {
    completed: true as const,
    no_project_yet: !project,
    project_slug: project?.slug ?? null,
    stage: project?.stage ?? stringAnswer("stage"),
    stage_other: project?.stageOther ?? stringAnswer("stage_other"),
    title: project?.title ?? stringAnswer("title"),
    format: project?.format ?? stringAnswer("format"),
    genre: project?.genre ?? stringAnswer("genre"),
    genre_other: project?.genreOther ?? stringAnswer("genre_other"),
    logline: project?.logline ?? stringAnswer("logline"),
    offer_per100: project?.offerPer100 ?? numberAnswer("offer_per100"),
    offer_other_text: project?.offerOtherText ?? stringAnswer("offer_other_text"),
    wants_lower: project?.wantsLower ?? booleanAnswer("wants_lower"),
    budget: project?.budget ?? numberAnswer("budget"),
    budget_from_example: project?.budgetFromExample ?? booleanAnswer("budget_from_example"),
    price_group: project?.priceGroup === "A" || project?.priceGroup === "B" ? project.priceGroup : null,
    deal_answer: project?.dealAnswer ?? stringAnswer("deal_answer"),
    payback_terms: project?.paybackTerms ?? stringAnswer("payback_terms"),
    payback_terms_other: project?.paybackTermsOther ?? stringAnswer("payback_terms_other"),
    showcase_requested: project?.showcaseRequested ?? null,
    approved: project?.approved ?? null,
    hidden: project?.hidden ?? null,
    synopsis: project?.synopsis ?? null,
    team_links: Array.isArray(project?.teamLinks) ? project.teamLinks.filter((item): item is string => typeof item === "string") : [],
    money_use: project?.moneyUse ?? null,
    distribution_plan: project?.distributionPlan ?? null,
    trailer_url: project?.trailerUrl ?? null,
    poster_url: project?.posterUrl ?? null,
    share_image_url: project?.shareImageUrl ?? null,
  };
  res.json(GetFilmmakerResultResponse.parse(response));
});

router.patch("/filmmakers/showcase", async (req, res): Promise<void> => {
  if (req.body === null || typeof req.body !== "object" || Array.isArray(req.body)
    || Object.keys(req.body).length === 0
    || Object.keys(req.body).some((key) => !SHOWCASE_FIELDS.has(key))) {
    res.status(400).json({ error: "Provide valid showcase fields to update." });
    return;
  }
  const parsed = UpdateFilmmakerShowcaseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid showcase details." });
    return;
  }
  if (parsed.data.team_links?.some((link) => {
    try {
      const url = new URL(link);
      return !["http:", "https:"].includes(url.protocol) || !url.hostname || Boolean(url.username || url.password);
    } catch {
      return true;
    }
  })) {
    res.status(400).json({ error: "Team links must be valid HTTP or HTTPS URLs." });
    return;
  }
  if (parsed.data.trailer_url != null) {
    try {
      const url = new URL(parsed.data.trailer_url);
      if (parsed.data.trailer_url.length > 2048
        || !["http:", "https:"].includes(url.protocol)
        || !url.hostname
        || Boolean(url.username || url.password)) {
        res.status(400).json({ error: "Trailer URL must be a valid HTTP or HTTPS URL." });
        return;
      }
    } catch {
      res.status(400).json({ error: "Trailer URL must be a valid HTTP or HTTPS URL." });
      return;
    }
  }
  const cookieId = req.cookies?.[VISITOR_COOKIE];
  if (typeof cookieId !== "string" || !UUID.test(cookieId)) {
    res.status(400).json({ error: "A recorded visitor cookie is required." });
    return;
  }
  const project = await updateOwnedFilmmakerShowcase({
    visitorId: cookieId,
    changes: parsed.data,
  });
  if (!project?.slug) {
    res.status(404).json({ error: "No completed filmmaker project was found." });
    return;
  }
  res.json(UpdateFilmmakerShowcaseResponse.parse({
    project_slug: project.slug,
    showcase_requested: Boolean(project.showcaseRequested),
    approved: project.approved,
    hidden: project.hidden,
    synopsis: project.synopsis,
    team_links: project.teamLinks?.filter((item): item is string => typeof item === "string") ?? [],
    money_use: project.moneyUse,
    distribution_plan: project.distributionPlan,
    trailer_url: project.trailerUrl,
  }));
});

export default router;