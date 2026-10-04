import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  pool,
  cleanupConfirmedTestProjects,
  TestProjectCleanupConflict,
  emailLogTable,
  getAdminFilmmakerPitch,
  filmmakersTable,
  flowProgressTable,
  investorMinimumsTable,
  investorsTable,
  messagesTable,
  pledgesTable,
  projectsTable,
  updateMessageVisibility,
  updateProjectReview,
  visitorsTable,
} from "@workspace/db";
import {
  GetAdminMeResponse,
  GetAdminTableParams,
  GetAdminTableResponse,
  GetAdminProjectReviewParams,
  ReviewAdminMessageBody,
  ReviewAdminMessageParams,
  ReviewAdminMessageResponse,
  ReviewAdminProjectBody,
  ReviewAdminProjectParams,
  ReviewAdminProjectResponse,
  GetAdminProjectReviewResponse,
  CleanupAdminTestProjectsBody,
  CleanupAdminTestProjectsResponse,
} from "@workspace/api-zod";
import { authorizeAdminIdentity } from "../lib/admin-auth";
import { reconcileReviewCheckouts } from "../lib/pitch-review-payments";
import { checkFilmmakerPitchDeckStatus, cleanupArchivedTestProjectMedia } from "./filmmaker-draft-materials";
import { trailerThumbnail } from "./projects";

const router: IRouter = Router();
type Section = "summary" | "pledges" | "location" | "funnels" | "market" | "price-test" | "queues" | "messages" | "channels" | "email-log";
type AdminTable = { section: Section; title: string; columns: string[]; rows: string[][]; total: number };

const SECTION_TITLES: Record<Section, string> = {
  summary: "Summary",
  pledges: "Pledges by project",
  location: "By location",
  funnels: "Funnels",
  market: "Market",
  "price-test": "Price test",
  queues: "Queues",
  messages: "Messages",
  channels: "Channels",
  "email-log": "Email log",
};

function text(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function buildTable(section: Section, columns: string[], rows: unknown[][]): AdminTable {
  return {
    section,
    title: SECTION_TITLES[section],
    columns,
    rows: rows.map((row) => row.map(text)),
    total: rows.length,
  };
}

function safeAdminWebUrl(value: string | null | undefined): string | null {
  if (!value || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname)
      && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

async function getAdminTable(section: Section): Promise<AdminTable> {
  const [
    filmmakers,
    projects,
    investors,
    pledges,
    minimums,
    messages,
    progress,
    visitors,
    emailLogs,
  ] = await Promise.all([
    db.select().from(filmmakersTable),
    db.select().from(projectsTable),
    db.select().from(investorsTable),
    db.select().from(pledgesTable),
    db.select().from(investorMinimumsTable),
    db.select().from(messagesTable),
    db.select().from(flowProgressTable),
    db.select().from(visitorsTable),
    db.select().from(emailLogTable),
  ]);

  const investorById = new Map(investors.map((investor) => [investor.id, investor]));
  const visitorById = new Map(visitors.map((visitor) => [visitor.visitorId, visitor]));
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const confirmedPledges = pledges.filter((pledge) => pledge.confirmed);

  if (section === "summary") {
    const confirmedProjectPledges = confirmedPledges.filter((pledge) => pledge.projectId != null);
    const unallocatedPledges = confirmedPledges.filter((pledge) => pledge.projectId == null);
    const confirmedTotal = confirmedPledges.reduce((sum, pledge) => sum + pledge.amount, 0);
    const accreditedInvestors = investors.filter((investor) => investor.accredited === "yes");
    const accreditedIds = new Set(accreditedInvestors.map((investor) => investor.id));
    const accreditedDollars = confirmedPledges
      .filter((pledge) => pledge.investorId != null && accreditedIds.has(pledge.investorId))
      .reduce((sum, pledge) => sum + pledge.amount, 0);
    const rows = [
      ["Filmmakers", filmmakers.length],
      ["Projects", projects.length],
      ["Showcased projects", projects.filter((project) => project.approved && !project.hidden).length],
      ["Investors", investors.length],
      ["Confirmed pledges", confirmedPledges.length],
      ["Confirmed pledged to projects", confirmedProjectPledges.reduce((sum, pledge) => sum + pledge.amount, 0)],
      ["Confirmed unallocated pledges", unallocatedPledges.reduce((sum, pledge) => sum + pledge.amount, 0)],
      ["Total confirmed pledged", confirmedTotal],
      ["Average confirmed pledge", confirmedPledges.length ? Math.round(confirmedTotal / confirmedPledges.length) : "—"],
      ["Accredited investors", accreditedInvestors.length],
      ["Confirmed accredited pledge dollars", accreditedDollars],
    ];
    return buildTable(section, ["Metric", "Value"], rows);
  }

  if (section === "pledges") {
    const rows = projects.map((project) => {
      const projectPledges = confirmedPledges.filter((pledge) => pledge.projectId === project.id);
      const people = new Set(projectPledges.map((pledge) => pledge.investorId).filter((id): id is number => id != null));
      const accreditedPeople = new Set([...people].filter((id) => investorById.get(id)?.accredited === "yes"));
      const cities = new Map<string, number>();
      for (const investorId of people) {
        const city = investorById.get(investorId)?.city;
        if (city) cities.set(city, (cities.get(city) ?? 0) + 1);
      }
      const topCity = [...cities.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "";
      return [
        project.title ?? "",
        project.stage ?? "",
        project.offerPer100 ?? "",
        people.size,
        projectPledges.reduce((sum, pledge) => sum + pledge.amount, 0),
        accreditedPeople.size,
        topCity,
      ];
    });
    return buildTable(section, ["Project", "Slate", "Offer per $100", "Confirmed pledgers", "Confirmed pledged", "Accredited pledgers", "Top city"], rows);
  }

  if (section === "location") {
    type Location = { country: string; state: string; city: string; investors: Set<number>; filmmakers: Set<number>; pledged: number };
    const locations = new Map<string, Location>();
    const ensureLocation = (country: string | null, state: string | null, city: string | null): Location => {
      const key = `${country ?? ""}\u0000${state ?? ""}\u0000${city ?? ""}`;
      let location = locations.get(key);
      if (!location) {
        location = { country: country ?? "", state: state ?? "", city: city ?? "", investors: new Set(), filmmakers: new Set(), pledged: 0 };
        locations.set(key, location);
      }
      return location;
    };
    investors.forEach((investor) => ensureLocation(null, investor.state, investor.city).investors.add(investor.id));
    filmmakers.forEach((filmmaker) => ensureLocation(filmmaker.country, filmmaker.state, filmmaker.city).filmmakers.add(filmmaker.id));
    for (const pledge of confirmedPledges) {
      const investor = pledge.investorId == null ? undefined : investorById.get(pledge.investorId);
      if (investor) ensureLocation(null, investor.state, investor.city).pledged += pledge.amount;
    }
    const rows = [...locations.values()]
      .sort((a, b) => a.country.localeCompare(b.country) || a.state.localeCompare(b.state) || a.city.localeCompare(b.city))
      .map((location) => [location.country, location.state, location.city, location.investors.size, location.pledged, location.filmmakers.size]);
    return buildTable(section, ["Country", "Region / State", "City", "Investors", "Confirmed pledged", "Filmmakers"], rows);
  }

  if (section === "funnels") {
    const rows: unknown[][] = [];
    for (const flow of ["filmmaker", "investor"] as const) {
      const records = progress.filter((record) => record.flow === flow);
      const screenCount = flow === "filmmaker" ? 6 : 5;
      for (let screen = 1; screen <= screenCount; screen += 1) {
        const reached = records.filter((record) => record.lastScreen >= screen).length;
        const previousReached = screen === 1 ? reached : records.filter((record) => record.lastScreen >= screen - 1).length;
        const dropoff = previousReached === 0 ? "—" : `${Math.round(((previousReached - reached) / previousReached) * 100)}%`;
        rows.push([flow, screen, reached, dropoff]);
      }
    }
    return buildTable(section, ["Flow", "Screen", "Reached", "Drop-off from previous screen"], rows);
  }

  if (section === "market") {
    const ladder = [125, 150, 175, 200];
    const rows: unknown[][] = [];
    const stageBuckets = [
      { label: "distribution", value: "distribution" },
      { label: "production", value: "production" },
      { label: "idea", value: "idea" },
      { label: "Legacy stage: other", value: "other" },
    ] as const;
    for (const slate of stageBuckets) {
      const slateProjects = projects.filter((project) => project.stage === slate.value);
      const slateMinimums = minimums.filter((minimum) => minimum.slate === slate.value);
      const offerCounts = ladder.map((offer) => slateProjects.filter((project) => project.offerPer100 === offer).length);
      const offer250Plus = slateProjects.filter((project) => (project.offerPer100 ?? 0) >= 250).length;
      const otherOffers = slateProjects.filter((project) => project.offerPer100 != null && !ladder.includes(project.offerPer100) && project.offerPer100 < 250).length;
      const minimumCounts = ladder.map((minimum) => slateMinimums.filter((answer) => !answer.notInterested && answer.minPer100 === minimum).length);
      const minimum250Plus = slateMinimums.filter((answer) => !answer.notInterested && answer.minPer100 != null && answer.minPer100 >= 250).length;
      const otherMinimums = slateMinimums.filter((answer) => !answer.notInterested && answer.minPer100 == null && Boolean(answer.otherText)).length;
      const notInterested = slateMinimums.filter((answer) => answer.notInterested).length;
      rows.push([slate.label, ...offerCounts, offer250Plus, otherOffers, slateProjects.filter((project) => project.wantsLower).length,
        ...minimumCounts, minimum250Plus, otherMinimums, notInterested]);
    }
    return buildTable(section, [
      "Slate", "Offers 125", "Offers 150", "Offers 175", "Offers 200", "Offers 250+",
      "Other offers", "Wants below floor", "Minimums 125", "Minimums 150", "Minimums 175",
      "Minimums 200", "Minimums 250+", "Other minimums", "Not interested",
    ], rows);
  }

  if (section === "price-test") {
    const rows: unknown[][] = [];
    for (const group of ["A", "B"]) {
      const groupVisitors = new Set(visitors.filter((visitor) => visitor.priceGroup === group).map((visitor) => visitor.visitorId));
      const groupProgress = progress.filter((record) => record.flow === "filmmaker" && groupVisitors.has(record.visitorId));
      const distributionProjects = projects.filter((project) => project.stage === "distribution" && project.priceGroup === group);
      const answers = ["yes", "maybe", "no"].map((answer) => distributionProjects.filter((project) => project.dealAnswer === answer).length);
      const offers = new Map<string, number>();
      for (const project of distributionProjects) {
        if (project.offerPer100 != null) offers.set(String(project.offerPer100), (offers.get(String(project.offerPer100)) ?? 0) + 1);
      }
      rows.push([
        group,
        groupProgress.length,
        groupProgress.filter((record) => record.completed).length,
        ...answers,
        [...offers.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map(([offer, count]) => `${offer}: ${count}`).join(", "),
      ]);
    }
    return buildTable(section, ["Group", "Started", "Completed", "Deal yes", "Deal maybe", "Deal no", "Distribution offers chosen"], rows);
  }

  if (section === "queues") {
    const rows: unknown[][] = [];
    for (const project of projects.filter((item) => item.showcaseRequested)) {
      const status = project.hidden ? "Hidden" : project.approved ? "Approved" : project.reviewDecision === "declined" ? "Declined" : "Pending";
      rows.push(["Approval", "", project.title ?? "", project.slug ?? "", project.createdAt, status, project.id]);
    }
    const callRecords: { priority: number; row: unknown[] }[] = [];
    investors.filter((investor) => investor.callOptIn).forEach((investor) => {
      const accredited = investor.accredited === "yes";
      callRecords.push({
        priority: accredited ? 0 : 1,
        row: ["Call", accredited ? "Accredited first" : "Retail", investor.name ?? "", investor.email ?? "", investor.createdAt, investor.accredited ?? "", ""],
      });
    });
    filmmakers.filter((filmmaker) => filmmaker.chatOptIn).forEach((filmmaker) => {
      callRecords.push({
        priority: 2,
        row: ["Filmmaker chat", "", filmmaker.name ?? "", filmmaker.email ?? "", filmmaker.createdAt, "Opted in", ""],
      });
    });
    callRecords.sort((a, b) => a.priority - b.priority);
    rows.push(...callRecords.map((item) => item.row));
    for (const message of messages.filter((item) => item.answer == null && !item.hidden)) {
      const project = message.projectId == null ? undefined : projectById.get(message.projectId);
      rows.push(["Unanswered question", "", message.investorName ?? "", project?.title ?? "", message.askedAt, "Waiting", ""]);
    }
    return buildTable(section, ["Queue", "Priority", "Person", "Details", "Created", "Status", "Project ID"], rows);
  }

  if (section === "messages") {
    const rows = messages.map((message) => {
      const project = message.projectId == null ? undefined : projectById.get(message.projectId);
      const responseMinutes = message.answeredAt
        ? Math.max(0, Math.round((message.answeredAt.getTime() - message.askedAt.getTime()) / 60_000))
        : "";
      return [
        project?.title ?? "",
        message.investorName ?? "",
        message.investorEmail ?? "",
        message.question ?? "",
        message.answer ?? "",
        message.askedAt,
        message.answeredAt ?? "",
        responseMinutes,
        message.reported,
        message.hidden,
        message.id,
      ];
    });
    return buildTable(section, ["Project", "Investor", "Investor email", "Question", "Answer", "Asked at", "Answered at", "Response minutes", "Reported", "Hidden", "Message ID"], rows);
  }

  if (section === "channels") {
    type Attribution = { kind: string; value: string; visitorIds: Set<string>; filmmakers: number; investors: number };
    const groups = new Map<string, Attribution>();
    const addAttribution = (kind: string, value: string | null, visitorId: string): void => {
      const label = value ?? "";
      const key = `${kind}\u0000${label}`;
      let item = groups.get(key);
      if (!item) {
        item = { kind, value: label, visitorIds: new Set(), filmmakers: 0, investors: 0 };
        groups.set(key, item);
      }
      item.visitorIds.add(visitorId);
    };
    visitors.forEach((visitor) => {
      if (visitor.utmSource) addAttribution("UTM source", visitor.utmSource, visitor.visitorId);
      if (visitor.refCodeUsed) addAttribution("Referral code", visitor.refCodeUsed, visitor.visitorId);
    });
    filmmakers.forEach((filmmaker) => {
      if (!filmmaker.visitorId) return;
      const visitor = visitorById.get(filmmaker.visitorId);
      if (!visitor) return;
      if (visitor.utmSource) {
        const item = groups.get(`UTM source\u0000${visitor.utmSource}`);
        if (item) item.filmmakers += 1;
      }
      if (visitor.refCodeUsed) {
        const item = groups.get(`Referral code\u0000${visitor.refCodeUsed}`);
        if (item) item.filmmakers += 1;
      }
    });
    investors.forEach((investor) => {
      if (!investor.visitorId) return;
      const visitor = visitorById.get(investor.visitorId);
      if (!visitor) return;
      if (visitor.utmSource) {
        const item = groups.get(`UTM source\u0000${visitor.utmSource}`);
        if (item) item.investors += 1;
      }
      if (visitor.refCodeUsed) {
        const item = groups.get(`Referral code\u0000${visitor.refCodeUsed}`);
        if (item) item.investors += 1;
      }
    });
    const rows = [...groups.values()]
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.value.localeCompare(b.value))
      .map((item) => [item.kind, item.value, item.visitorIds.size, item.filmmakers, item.investors]);
    return buildTable(section, ["Attribution", "Value", "Visitors", "Filmmakers", "Investors"], rows);
  }

  const rows = emailLogs.map((entry) => [entry.to, entry.type, entry.status, entry.createdAt]);
  return buildTable(section, ["To", "Type", "Status", "Created at"], rows);
}

router.get("/admin/me", async (req, res): Promise<void> => {
  const identity = await authorizeAdminIdentity(req, res);
  if (!identity) return;
  res.json(GetAdminMeResponse.parse({ email: identity.email, role: "admin" }));
});

router.get("/admin/tables/:section", async (req, res): Promise<void> => {
  const identity = await authorizeAdminIdentity(req, res);
  if (!identity) return;
  const parsedParams = GetAdminTableParams.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: "Invalid admin table section." });
    return;
  }
  if (parsedParams.data.section === "queues") {
    try {
      await reconcileReviewCheckouts();
    } catch (error) {
      req.log.error({ error }, "Could not reconcile pending review payments");
      res.status(503).json({ error: "Payment verification is unavailable. Please try again before reviewing pitches." });
      return;
    }
  }
  const table = await getAdminTable(parsedParams.data.section);
  res.json(GetAdminTableResponse.parse(table));
});

router.post("/admin/confirmed-test-project-cleanup", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const identity = await authorizeAdminIdentity(req, res);
  if (!identity) return;
  const body = CleanupAdminTestProjectsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "An environment, dry-run choice, and explicit deletion confirmation are required." });
    return;
  }
  const runtimeEnvironment = process.env.NODE_ENV === "production" ? "published"
    : process.env.NODE_ENV === "development" ? "preview" : null;
  if (!runtimeEnvironment || body.data.environment !== runtimeEnvironment) {
    res.status(409).json({ error: "The requested environment does not match this server. Nothing was deleted." });
    return;
  }
  let deletionCommitted = false;
  try {
    const result = await cleanupConfirmedTestProjects(pool, runtimeEnvironment, body.data.dry_run);
    deletionCommitted = !body.data.dry_run;
    const media = await cleanupArchivedTestProjectMedia(runtimeEnvironment, body.data.dry_run || !body.data.cleanup_media);
    req.log.info({ environment: runtimeEnvironment, dryRun: body.data.dry_run, deletedCount: result.deleted_count },
      "Confirmed test project cleanup");
    res.json(CleanupAdminTestProjectsResponse.parse({ ...result, ...media }));
  } catch (error) {
    if (error instanceof TestProjectCleanupConflict) {
      res.status(409).json({ error: error.message });
      return;
    }
    req.log.error({ deletionCommitted }, "Confirmed test project cleanup could not finish.");
    res.status(500).json({ error: deletionCommitted
      ? "Project deletion committed, but media inspection could not finish. Check the private archive before retrying."
      : "Project cleanup could not finish. No uncommitted changes were retained." });
  }
});

router.patch("/admin/projects/:projectId", async (req, res): Promise<void> => {
  const identity = await authorizeAdminIdentity(req, res);
  if (!identity) return;

  const parsedParams = ReviewAdminProjectParams.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: "Invalid project ID." });
    return;
  }
  const parsedBody = ReviewAdminProjectBody.safeParse(req.body);
  if (!parsedBody.success || (parsedBody.data.approved === undefined && parsedBody.data.hidden === undefined)) {
    res.status(400).json({ error: "At least one of approved or hidden must be provided." });
    return;
  }
  if (parsedBody.data.approved === true) {
    const [candidate] = await db.select().from(projectsTable).where(eq(projectsTable.id, parsedParams.data.projectId));
    if (!candidate?.showcaseRequested) {
      res.status(409).json({ error: "This pitch has not been submitted for review." });
      return;
    }
  }

  const project = await updateProjectReview(parsedParams.data.projectId, parsedBody.data);
  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  res.json(ReviewAdminProjectResponse.parse(project));
});

router.get("/admin/projects/:projectId/review", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const identity = await authorizeAdminIdentity(req, res);
  if (!identity) return;
  const parsedParams = GetAdminProjectReviewParams.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: "Invalid project ID." });
    return;
  }
  const pitch = await getAdminFilmmakerPitch(parsedParams.data.projectId);
  if (!pitch) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  const answers = pitch.answers;
  const answerString = (key: string): string | null =>
    typeof answers[key] === "string" ? answers[key] as string : null;
  const answerBoolean = (key: string): boolean | null =>
    typeof answers[key] === "boolean" ? answers[key] as boolean : null;
  const answerNumber = (key: string): number | null =>
    typeof answers[key] === "number" ? answers[key] as number : null;
  const answerStrings = (key: string): string[] =>
    Array.isArray(answers[key]) ? (answers[key] as unknown[]).filter((value): value is string => typeof value === "string") : [];
  const project = pitch.project;
  const filmmaker = pitch.filmmaker;
  const projectAnswers = {
    ...answers,
    ...(project.crowdfunding ?? {}),
    team_info: project.teamInfo ?? null,
    stage: project.stage ?? answerString("stage"),
    stage_other: project.stageOther ?? answerString("stage_other"),
    title: project.title ?? answerString("title"),
    format: project.format ?? answerString("format"),
    genre: project.genre ?? answerString("genre"),
    genre_other: project.genreOther ?? answerString("genre_other"),
    logline: project.logline ?? answerString("logline"),
    budget: project.budget ?? answerNumber("budget"),
    budget_from_example: project.budgetFromExample ?? answerBoolean("budget_from_example"),
    deal_answer: project.dealAnswer ?? answerString("deal_answer"),
    offer_per100: project.offerPer100 ?? answerNumber("offer_per100"),
    offer_other_text: project.offerOtherText ?? answerString("offer_other_text"),
    wants_lower: project.wantsLower ?? answerBoolean("wants_lower"),
    payback_terms: project.paybackTerms ?? answerString("payback_terms"),
    payback_terms_other: project.paybackTermsOther ?? answerString("payback_terms_other"),
    funding_sources: answerStrings("funding_sources"),
    funding_other: answerString("funding_other"),
    reached_goal: answerBoolean("reached_goal"),
    funding_experience: answerString("funding_experience"),
    team_links: Array.isArray(project.teamLinks) && project.teamLinks.length
      ? project.teamLinks.map(safeAdminWebUrl).filter((value): value is string => value !== null)
      : answerStrings("team_links").map(safeAdminWebUrl).filter((value): value is string => value !== null),
    money_use: project.moneyUse ?? answerString("money_use"),
    distribution_plan: project.distributionPlan ?? answerString("distribution_plan"),
    synopsis: project.synopsis ?? answerString("synopsis"),
    trailer_url: safeAdminWebUrl(project.trailerUrl ?? answerString("trailer_url")),
    pilot_url: safeAdminWebUrl(project.pilotUrl ?? answerString("pilot_url")),
    poster_url: safeAdminWebUrl(project.posterUrl ?? answerString("poster_url")),
    share_image_url: safeAdminWebUrl(project.shareImageUrl ?? answerString("share_image_url")),
    pitch_deck_name: project.pitchDeckName,
  };
  const eligibleDeckUrl = project.pitchDeckStoragePath
    ? `/api/filmmakers/project-materials/pitch-deck?project_id=${project.id}`
    : null;
  const [deckStatus, thumbnail] = await Promise.all([
    checkFilmmakerPitchDeckStatus(project.pitchDeckStoragePath),
    trailerThumbnail(project.trailerUrl),
  ]);
  const response = {
    original_submission: publicSubmissionSnapshot(project),
    submission_provenance: pitch.provenance,
    changes_since_submission: hasSubmissionChanges(project),
    review_notes: { notes: "", obligations_checked: false, authority_checked: false, questions_resolved: false, updated_at: null, ...(project.reviewNotes ?? {}) },
    review_history: project.reviewHistory ?? [],
    project: {
      team_info: projectAnswers.team_info,
      team_links: projectAnswers.team_links,
      money_use: projectAnswers.money_use,
      distribution_plan: projectAnswers.distribution_plan,
      proposal: project.proposal ?? null,
      id: project.id,
      title: projectAnswers.title,
      format: projectAnswers.format,
      genre: projectAnswers.genre,
      stage: projectAnswers.stage,
      stage_other: projectAnswers.stage_other,
      logline: projectAnswers.logline,
      budget: projectAnswers.budget,
      budget_from_example: projectAnswers.budget_from_example,
      deal_answer: projectAnswers.deal_answer,
      offer_per100: projectAnswers.offer_per100,
      offer_other_text: projectAnswers.offer_other_text,
      wants_lower: projectAnswers.wants_lower,
      payback_terms: projectAnswers.payback_terms,
      payback_terms_other: projectAnswers.payback_terms_other,
      funding_sources: projectAnswers.funding_sources,
      funding_other: projectAnswers.funding_other,
      reached_goal: projectAnswers.reached_goal,
      funding_experience: projectAnswers.funding_experience,
    },
    filmmaker: filmmaker ? {
      id: filmmaker.id,
      name: filmmaker.name,
      email: filmmaker.email,
      phone: filmmaker.phone,
      phone_verified: filmmaker.phoneVerified,
      city: filmmaker.city,
      state: filmmaker.state,
      country: filmmaker.country,
      favorite_genres: filmmaker.favoriteGenres ?? [],
      chat_opt_in: filmmaker.chatOptIn,
      no_project_yet: filmmaker.noProjectYet,
    } : null,
    answers: projectAnswers,
    materials: {
      synopsis: projectAnswers.synopsis,
      trailer_url: projectAnswers.trailer_url,
      pilot_url: projectAnswers.pilot_url,
      poster_url: projectAnswers.poster_url,
      share_image_url: projectAnswers.share_image_url,
      pitch_deck_url: eligibleDeckUrl,
      pitch_deck_name: project.pitchDeckName,
      pitch_deck_status: deckStatus,
      trailer_thumbnail_url: thumbnail,
    },
  };

function publicSubmissionSnapshot(project: typeof projectsTable.$inferSelect) {
  if (!project.submissionSnapshot) return null;
  const saved = project.submissionSnapshot;
  const original = saved.project as Record<string, unknown> | undefined;
  const safeProject = Object.fromEntries(Object.entries(original ?? {}).filter(([key]) =>
    !["filmmakerId", "posterStoragePath", "shareImageStoragePath", "pitchDeckStoragePath", "bunnyVideoId", "pendingBunnyVideoId"].includes(key)));
  return {
    ...saved, project: safeProject,
    materials: {
      synopsis: original?.synopsis ?? null,
      poster_url: safeAdminWebUrl(typeof original?.posterUrl === "string" ? original.posterUrl : null),
      share_image_url: safeAdminWebUrl(typeof original?.shareImageUrl === "string" ? original.shareImageUrl : null),
      trailer_url: safeAdminWebUrl(typeof original?.trailerUrl === "string" ? original.trailerUrl : null),
      pilot_url: safeAdminWebUrl(typeof original?.pilotUrl === "string" ? original.pilotUrl : null),
      deck_name: original?.pitchDeckName ?? null,
      deck_url: original?.pitchDeckStoragePath ? `/api/filmmakers/project-materials/pitch-deck?project_id=${project.id}&original=1` : null,
    },
  };
}
function hasSubmissionChanges(project: typeof projectsTable.$inferSelect): boolean {
  const original = project.submissionSnapshot?.project as Record<string, unknown> | undefined;
  if (!original) return false;
  const fields = ["title", "logline", "format", "genre", "genreOther", "stage", "budget", "proposal", "synopsis", "teamInfo", "teamLinks", "moneyUse", "distributionPlan", "trailerUrl", "pilotUrl", "posterUrl", "shareImageUrl", "pitchDeckStoragePath", "crowdfunding"] as const;
  return fields.some(key => JSON.stringify(original[key] ?? null) !== JSON.stringify(project[key] ?? null));
}
  res.json(GetAdminProjectReviewResponse.parse(response));
});

router.patch("/admin/messages/:messageId", async (req, res): Promise<void> => {
  const identity = await authorizeAdminIdentity(req, res);
  if (!identity) return;

  const parsedParams = ReviewAdminMessageParams.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: "Invalid message ID." });
    return;
  }
  const parsedBody = ReviewAdminMessageBody.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: "A boolean hidden value is required." });
    return;
  }

  const message = await updateMessageVisibility(parsedParams.data.messageId, parsedBody.data.hidden);
  if (!message) {
    res.status(404).json({ error: "Message not found." });
    return;
  }
  res.json(ReviewAdminMessageResponse.parse(message));
});

export default router;