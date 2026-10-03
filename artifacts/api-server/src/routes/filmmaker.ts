import cookieParser from "cookie-parser";
import { Router, type IRouter } from "express";
import {
  createFilmmakerSubmission,
  FilmmakerSubmissionError,
  getCompletedFilmmakerResult,
  getFilmmakerAccountVisitorOwner,
  findVisitorFlowProgress,
  updateOwnedFilmmakerShowcase,
  type FilmmakerSubmissionData,
  snapshotProposal,
} from "@workspace/db";
import {
  SubmitFilmmakerBody,
  SubmitFilmmakerResponse,
  GetFilmmakerSubmissionConfigResponse,
  GetFilmmakerResultResponse,
  UpdateFilmmakerShowcaseBody,
  UpdateFilmmakerShowcaseResponse,
} from "@workspace/api-zod";
import {
  authenticateFilmmaker,
  authorizeFilmmakerVisitor,
  requireMatchingFilmmakerContext,
} from "../lib/filmmaker-auth";
import { recordTransactionalEmailStatus, sendTransactionalEmail } from "../lib/mailjet";
import { reserveFilmmakerSubmissionAttempt } from "../lib/filmmaker-submission-limit";
import { cleanupDiscardedDraftMaterials } from "./filmmaker-draft-materials";
import { issuePitchReviewProof } from "../lib/pitch-review-proof";
import { requireAccountAgeConfirmation } from "../lib/age-confirmation";

const router: IRouter = Router();
router.use(cookieParser());

const VISITOR_COOKIE = "msi_visitor_id";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHOWCASE_FIELDS = new Set([
  "team_info", "crowdfunding_ran", "crowdfunding_campaign", "crowdfunding_same_project", "crowdfunding_goal", "crowdfunding_raised", "crowdfunding_obligations",
  "showcase_requested", "synopsis", "team_links", "money_use", "distribution_plan", "trailer_url",
]);
const INPUT_FIELDS = new Set([
  "team_info", "team_links", "money_use", "distribution_plan",
  "crowdfunding_ran", "crowdfunding_campaign", "crowdfunding_same_project", "crowdfunding_goal", "crowdfunding_raised", "crowdfunding_obligations",
  "proposal", "age_confirmed",
  "website",
  "no_project_yet", "stage", "title", "format", "genre", "genre_other",
  "logline", "trailer_url", "pilot_url", "budget", "budget_from_example", "deal_answer",
  "offer_per100", "offer_other_text", "wants_lower", "payback_terms", "payback_terms_other",
  "funding_sources", "funding_other", "reached_goal", "funding_experience", "name", "email",
  "city", "state", "country", "favorite_genres", "chat_opt_in", "phone",
]);
const FUNDING_SOURCES = new Set([
  "Own money",
  "Friends & family",
  "Kickstarter / Indiegogo / Seed&Spark",
  "Grants",
  "Investors",
  "Studios",
  "Haven’t yet",
  "Other",
]);
const NO_FUNDING_YET = "Haven’t yet";

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

function publicAppBase(): string | null {
  const configured = process.env.PUBLIC_APP_URL;
  if (!configured) return null;
  try {
    const url = new URL(configured);
    const hostname = url.hostname.toLowerCase();
    if (!["http:", "https:"].includes(url.protocol)
      || !hostname || url.username || url.password || url.search || url.hash
      || hostname === "localhost"
      || hostname.endsWith(".localhost")
      || hostname === "::1"
      || hostname.startsWith("127.")) return null;
    return `${url.origin}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return null;
  }
}

function safeCalendlyUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && url.hostname && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

router.get("/filmmaker-submission-config", (_req, res): void => {
  res.json(GetFilmmakerSubmissionConfigResponse.parse({
    available: true,
  }));
});

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
  const { website, ...data } = parsed.data;
  if (data.team_links?.some((link) => {
    try { const url = new URL(link); return !["http:", "https:"].includes(url.protocol) || Boolean(url.username || url.password); }
    catch { return true; }
  })) {
    res.status(400).json({ error: "Team links must be valid HTTP or HTTPS links." }); return;
  }
  if (website?.trim()) {
    res.status(400).json({ error: "Invalid filmmaker submission." });
    return;
  }
  const cookieId = req.cookies?.[VISITOR_COOKIE];
  if (typeof cookieId !== "string" || !UUID.test(cookieId)) {
    res.status(400).json({ error: "A recorded visitor cookie is required to submit." });
    return;
  }
  const identity = await authenticateFilmmaker(req, res, true);
  if (!identity) return;
  if (!await requireAccountAgeConfirmation(identity, res)) return;
  const access = await authorizeFilmmakerVisitor(req, res, cookieId);
  if (!access.allowed) return;
  const owner = await getFilmmakerAccountVisitorOwner(cookieId);
  if (!owner || owner.provider !== identity.provider || owner.uid !== identity.uid) {
    res.status(403).json({ error: "Connect this saved browser draft to your verified account before sending the final submission." });
    return;
  }
  const draft = await findVisitorFlowProgress(cookieId, "filmmaker");
  if (!draft || draft.completed) {
    res.status(409).json({ error: "No current filmmaker draft was found for this visitor." });
    return;
  }
  if (!requireMatchingFilmmakerContext(req, res, "X-MSI-Draft-Id", draft.id, "draft")) return;

  if (!data.no_project_yet) {
    if (!data.proposal || !data.stage) {
      res.status(400).json({ error: "Review and save the structured project repayment proposal before submitting." });
      return;
    }
    try {
      const proposal = snapshotProposal(data.stage, data.proposal);
      if (data.offer_per100 !== proposal.repayment_per100 || data.wants_lower) {
        res.status(400).json({ error: "The saved repayment target must match the selected proposal." });
        return;
      }
      Object.assign(data, { proposal });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid proposal." });
      return;
    }
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
    ];
    const sources = data.funding_sources ?? [];
    const hasNoFundingYet = sources.includes(NO_FUNDING_YET);
    const hasFundingHistory = !(sources.length === 1 && hasNoFundingYet);
    if (requiredProjectValues.some(([, value]) => value === undefined)
      || sources.length === 0
      || sources.some((source) => !FUNDING_SOURCES.has(source))
      || (hasNoFundingYet && sources.length !== 1)
      || (sources.includes("Other") && !hasText(data.funding_other))
      || (hasFundingHistory && (data.reached_goal === undefined || !hasText(data.funding_experience)))
      || (!hasFundingHistory && (data.reached_goal !== undefined || data.funding_experience !== undefined))
      || !hasText(data.title)
      || !hasText(data.logline)
      || (data.genre === "Other" && !hasText(data.genre_other))
      || (data.payback_terms === "other" && !hasText(data.payback_terms_other))) {
      res.status(400).json({ error: "Project, offer, and funding details are required for project submissions." });
      return;
    }
  }

  try {
    if (!await reserveFilmmakerSubmissionAttempt(req.ip ?? "unknown", cookieId)) {
      res.setHeader("Retry-After", "3600");
      res.status(429).json({ error: "Too many submission attempts. Please try again later." });
      return;
    }
  } catch {
    req.log.error("Filmmaker submission rate limiter unavailable");
    res.status(503).json({ error: "Submission is temporarily unavailable. Please try again later." });
    return;
  }

  try {
    const result = await createFilmmakerSubmission({
      visitorId: cookieId,
      ...(identity?.provider === "firebase" ? { firebaseUid: identity.uid } : {}),
      ...(identity?.provider === "replit" ? { replitUid: identity.uid } : {}),
      firebaseEmail: identity?.email,
      data: data as FilmmakerSubmissionData,
    });
    if (result.discardedDraftMaterials) {
      await cleanupDiscardedDraftMaterials({
        visitorId: cookieId,
        ...result.discardedDraftMaterials,
      });
    }

    const emailType = "filmmaker_submission";
    try {
      let projectUrl: string | null = null;
      let projectLookupFailed = false;
      const appUrl = publicAppBase();
      if (result.projectId !== null) {
        try {
          const completion = await getCompletedFilmmakerResult(cookieId);
          if (completion?.project?.slug && appUrl) {
            projectUrl = `${appUrl}/project/${encodeURIComponent(completion.project.slug)}`;
          } else {
            projectLookupFailed = true;
          }
        } catch {
          projectLookupFailed = true;
        }
      }

      if (projectLookupFailed || !appUrl) {
        await recordTransactionalEmailStatus(data.email, emailType, "failed");
        req.log.warn({ type: emailType }, "Filmmaker confirmation email could not include its project link");
      } else {
        const calendlyUrl = data.chat_opt_in ? safeCalendlyUrl(process.env.FILMMAKER_CALENDLY_URL) : null;
        const textParts = [
          `Hi ${data.name},`,
          "",
          "Thank you for submitting to Movie Show Investing. We’ve received your filmmaker submission.",
          "",
          `View your private filmmaker desk: ${appUrl}/me/projects`,
        ];
        if (projectUrl) textParts.push("", `Share your public project page: ${projectUrl}`);
        if (calendlyUrl) textParts.push("", `Choose a time to chat: ${calendlyUrl}`);
        textParts.push("", "The Movie Show Investing team");
        const htmlParts = [
          `<p>Hi ${htmlEscape(data.name)},</p>`,
          "<p>Thank you for submitting to <strong>Movie Show Investing</strong>. We’ve received your filmmaker submission.</p>",
          `<p><a href="${htmlEscape(`${appUrl}/me/projects`)}" style="display:inline-block;padding:12px 20px;background:#902f4d;color:#fff;text-decoration:none">View my project</a></p>`,
        ];
        if (projectUrl) {
          htmlParts.push(`<p>Public share link: <a href="${htmlEscape(projectUrl)}">${htmlEscape(projectUrl)}</a></p>`);
        }
        if (calendlyUrl) {
          htmlParts.push(`<p>Since you opted in to a conversation, <a href="${htmlEscape(calendlyUrl)}">choose a time to chat</a>.</p>`);
        }
        htmlParts.push("<p>Warmly,<br>The Movie Show Investing team</p>");
        await sendTransactionalEmail({
          to: data.email,
          type: emailType,
          subject: "We received your filmmaker submission",
          text: textParts.join("\n"),
          html: `<div style="max-width:600px;margin:0 auto;padding:32px 24px;font-family:Arial,sans-serif;line-height:1.6;color:#172033"><div style="margin-bottom:24px;font-size:20px;font-weight:bold;letter-spacing:.04em;color:#172554">MOVIE SHOW INVESTING</div>${htmlParts.join("")}</div>`,
        });
      }
    } catch {
      await recordTransactionalEmailStatus(data.email, emailType, "failed");
      req.log.warn({ type: emailType }, "Filmmaker confirmation email handling failed");
    }

    res.status(201).json(SubmitFilmmakerResponse.parse({
      filmmaker_id: result.filmmakerId,
      project_id: result.projectId,
      checkout_proof: result.projectId ? issuePitchReviewProof(result.projectId) : null,
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
  res.set("Cache-Control", "no-store");
  const cookieId = req.cookies?.[VISITOR_COOKIE];
  if (typeof cookieId !== "string" || !UUID.test(cookieId)) {
    res.status(404).json({ error: "No completed filmmaker submission was found." });
    return;
  }
  const access = await authorizeFilmmakerVisitor(req, res, cookieId);
  if (!access.allowed) return;
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
    team_info: project?.teamInfo ?? null,
    ...(project?.crowdfunding ?? {}),
    completed: true as const,
    no_project_yet: !project,
    project_id: project?.id ?? null,
    project_slug: project?.slug ?? null,
    checkout_proof: project ? issuePitchReviewProof(project.id) : null,
    stage: project?.stage ?? stringAnswer("stage"),
    stage_other: project?.stageOther ?? stringAnswer("stage_other"),
    title: project?.title ?? stringAnswer("title"),
    format: project?.format ?? stringAnswer("format"),
    genre: project?.genre ?? stringAnswer("genre"),
    genre_other: project?.genreOther ?? stringAnswer("genre_other"),
    logline: project?.logline ?? stringAnswer("logline"),
    offer_per100: project?.offerPer100 ?? numberAnswer("offer_per100"),
    proposal: project?.proposal ?? null,
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
  const access = await authorizeFilmmakerVisitor(req, res, cookieId);
  if (!access.allowed) return;
  const current = await getCompletedFilmmakerResult(cookieId);
  if (!current?.project) {
    res.status(404).json({ error: "No completed filmmaker project was found." });
    return;
  }
  if (access.identity
    && !requireMatchingFilmmakerContext(req, res, "X-MSI-Project-Id", current.project.id, "project")) return;
  if (parsed.data.showcase_requested === true
    && !current.project.reviewPaidAt && !current.project.showcaseRequested && !current.project.approved) {
    res.status(402).json({ error: "Pay the $49 review fee before submitting this pitch for review." });
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