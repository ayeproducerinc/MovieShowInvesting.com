import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";
import pg from "pg";
import * as schema from "./schema";
import {
  flowProgressTable,
  filmmakerAccountVisitorsTable,
  filmmakerActivityTable,
  filmmakerDraftMaterialsTable,
  filmmakersTable,
  investorsTable,
  projectsTable,
  visitorsTable,
  ageConfirmationsTable,
  type FlowProgressRecord,
} from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

export * from "./schema";
export * from "./filmmaker-materials";
export * from "./filmmaker-activity";
export * from "./proposal";
export * from "./test-project-cleanup";
export * from "./draft-reset";

export async function ensureVisitor(visitorId: string): Promise<void> {
  await db.insert(visitorsTable).values({ visitorId }).onConflictDoNothing();
}

export async function recordVisitorAttribution(input: {
  visitorId: string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  refCodeUsed: string | null;
}): Promise<void> {
  await db.insert(visitorsTable).values(input).onConflictDoUpdate({
    target: visitorsTable.visitorId,
    set: {
      utmSource: sql`coalesce(${visitorsTable.utmSource}, excluded.utm_source)`,
      utmMedium: sql`coalesce(${visitorsTable.utmMedium}, excluded.utm_medium)`,
      utmCampaign: sql`coalesce(${visitorsTable.utmCampaign}, excluded.utm_campaign)`,
      refCodeUsed: sql`coalesce(${visitorsTable.refCodeUsed}, excluded.ref_code_used)`,
    },
  });
}

export async function readVisitorPriceGroup(visitorId: string): Promise<"A" | "B" | null> {
  const [visitor] = await db.select({ priceGroup: visitorsTable.priceGroup })
    .from(visitorsTable)
    .where(eq(visitorsTable.visitorId, visitorId));
  return visitor?.priceGroup === "A" || visitor?.priceGroup === "B" ? visitor.priceGroup : null;
}

export async function assignVisitorPriceGroup(visitorId: string, group: "A" | "B"): Promise<"A" | "B" | null> {
  const [assigned] = await db.update(visitorsTable)
    .set({ priceGroup: group })
    .where(and(eq(visitorsTable.visitorId, visitorId), isNull(visitorsTable.priceGroup)))
    .returning({ priceGroup: visitorsTable.priceGroup });
  return assigned?.priceGroup === "A" || assigned?.priceGroup === "B" ? assigned.priceGroup : null;
}

export async function findVisitorFlowProgress(visitorId: string, flow: "filmmaker" | "investor"): Promise<FlowProgressRecord | undefined> {
  const [record] = await db.select().from(flowProgressTable).where(and(
    eq(flowProgressTable.visitorId, visitorId),
    eq(flowProgressTable.flow, flow),
  ));
  return record;
}

const meaningfulFilmmakerTextAnswers = [
  "stage", "stage_other", "title", "genre", "genre_other", "logline", "trailer_url", "pilot_url",
  "deal_answer", "offer_choice", "offer_other_text", "payback_terms", "payback_terms_other",
  "funding_other", "funding_experience", "name", "email", "phone", "city", "state", "country",
] as const;

function hasMeaningfulFilmmakerAnswers(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const answers = value as Record<string, unknown>;
  if (meaningfulFilmmakerTextAnswers.some((key) =>
    typeof answers[key] === "string" && (answers[key] as string).trim().length > 0)) return true;
  if (answers.no_project_yet === true || answers.wants_lower === true
    || answers.chat_opt_in === true || answers.location_manual === true
    || answers.reached_goal === true || answers.reached_goal === false
    || answers.budget_mode === "custom" || answers.format === "show") return true;
  if (typeof answers.budget === "number" && answers.budget > 0) return true;
  if (typeof answers.offer_per100 === "number" && answers.offer_per100 > 0) return true;
  return ["funding_sources", "favorite_genres"].some((key) =>
    Array.isArray(answers[key]) && answers[key].length > 0);
}

function hasMeaningfulFilmmakerMaterials(
  materials: typeof filmmakerDraftMaterialsTable.$inferSelect | undefined,
): boolean {
  return Boolean(materials && [
    materials.synopsis, materials.trailerUrl, materials.bunnyVideoId, materials.posterUrl,
    materials.posterStoragePath, materials.shareImageUrl, materials.shareImageStoragePath,
    materials.pitchDeckStoragePath, materials.pitchDeckName,
  ].some((value) => typeof value === "string" && value.trim().length > 0));
}

export function hasMeaningfulFilmmakerDraft(
  progress: Pick<FlowProgressRecord, "answers" | "completed"> | undefined,
  materials: typeof filmmakerDraftMaterialsTable.$inferSelect | undefined,
): boolean {
  return Boolean(progress && !progress.completed
    && (hasMeaningfulFilmmakerAnswers(progress.answers) || hasMeaningfulFilmmakerMaterials(materials)));
}

/** True only for an unfinished, meaningful filmmaker draft with no account owner. */
export async function hasUnlinkedMeaningfulFilmmakerDraft(visitorId: string): Promise<boolean> {
  const [link] = await db.select({ visitorId: filmmakerAccountVisitorsTable.visitorId })
    .from(filmmakerAccountVisitorsTable)
    .where(eq(filmmakerAccountVisitorsTable.visitorId, visitorId))
    .limit(1);
  if (link) return false;

  const [progress] = await db.select().from(flowProgressTable).where(and(
    eq(flowProgressTable.visitorId, visitorId),
    eq(flowProgressTable.flow, "filmmaker"),
  )).limit(1);
  if (!progress || progress.completed) return false;
  const [materials] = await db.select().from(filmmakerDraftMaterialsTable)
    .where(eq(filmmakerDraftMaterialsTable.visitorId, visitorId))
    .limit(1);
  return hasMeaningfulFilmmakerDraft(progress, materials);
}

export async function visitorExists(visitorId: string): Promise<boolean> {
  const [visitor] = await db.select({ visitorId: visitorsTable.visitorId })
    .from(visitorsTable)
    .where(eq(visitorsTable.visitorId, visitorId));
  return Boolean(visitor);
}

export async function saveVisitorFlowProgress(input: {
  visitorId: string;
  flow: "filmmaker" | "investor";
  lastScreen: number;
  answers: Record<string, unknown>;
  completed: boolean;
  expectedDraftId?: number;
}): Promise<FlowProgressRecord> {
  if (input.flow === "filmmaker") {
    return db.transaction(async (tx) => {
      const [visitor] = await tx.select({ visitorId: visitorsTable.visitorId, retired: visitorsTable.filmmakerDraftResetAt })
        .from(visitorsTable)
        .where(eq(visitorsTable.visitorId, input.visitorId))
        .for("update");
      if (visitor?.retired) throw new FilmmakerAccountError("account_draft_conflict", "This draft was cleared. Select Start over to open a fresh worksheet.");

      const [existing] = await tx.select().from(flowProgressTable).where(and(
        eq(flowProgressTable.visitorId, input.visitorId),
        eq(flowProgressTable.flow, "filmmaker"),
      ));
      if ((existing && input.expectedDraftId !== existing.id) || (input.expectedDraftId !== undefined && existing?.id !== input.expectedDraftId)) {
        throw new FilmmakerAccountError("account_draft_conflict", "This draft changed. Refresh before saving.");
      }
      if (existing?.completed) {
        return existing;
      }

      const [record] = await tx.insert(flowProgressTable).values({
        ...input,
        completed: false,
      }).onConflictDoUpdate({
        target: [flowProgressTable.visitorId, flowProgressTable.flow],
        set: {
          lastScreen: input.lastScreen,
          answers: input.answers,
          completed: false,
          updatedAt: new Date(),
        },
      }).returning();
      if (hasMeaningfulFilmmakerDraft(record, undefined)) {
        await tx.insert(filmmakerActivityTable).values({
          identityKey: `visitor:${input.visitorId}`,
          visitorId: input.visitorId,
        }).onConflictDoNothing();
      }
      return record;
    });
  }

  const [record] = await db.insert(flowProgressTable).values(input).onConflictDoUpdate({
    target: [flowProgressTable.visitorId, flowProgressTable.flow],
    set: {
      lastScreen: input.lastScreen,
      answers: input.answers,
      completed: input.completed,
      updatedAt: new Date(),
    },
  }).returning();
  return record;
}

export type FilmmakerSubmissionData = {
  team_info?: string;
  team_links?: string[];
  money_use?: string;
  distribution_plan?: string;
  crowdfunding_ran?: boolean;
  crowdfunding_campaign?: string;
  crowdfunding_same_project?: boolean;
  crowdfunding_goal?: number;
  crowdfunding_raised?: number;
  crowdfunding_obligations?: string;
  proposal?: import("./proposal").Proposal;
  no_project_yet: boolean;
  stage?: "distribution" | "production" | "idea";
  title?: string;
  format?: "movie" | "show";
  genre?: "Horror" | "Drama" | "Comedy" | "Thriller" | "Documentary" | "Sci-Fi" | "Romance" | "Action" | "Animation" | "Other";
  genre_other?: string;
  logline?: string;
  trailer_url?: string;
  pilot_url?: string;
  budget?: number;
  budget_from_example?: boolean;
  deal_answer?: "yes" | "maybe" | "no";
  offer_per100?: number;
  offer_other_text?: string;
  wants_lower?: boolean;
  payback_terms?: "works" | "need_some" | "other";
  payback_terms_other?: string;
  funding_sources?: string[];
  funding_other?: string;
  reached_goal?: boolean;
  funding_experience?: string;
  name: string;
  email: string;
  city: string;
  state?: string;
  country?: string;
  favorite_genres: string[];
  chat_opt_in: boolean;
  phone?: string;
};

export class FilmmakerSubmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FilmmakerSubmissionError";
  }
}

export type FilmmakerAccountErrorCode =
  | "visitor_not_found"
  | "visitor_owned_by_another_account"
  | "verified_email_mismatch"
  | "account_draft_conflict"
  | "completed_submission_unclaimed"
  | "submission_not_found"
  | "draft_not_found"
  | "project_not_found";

export class FilmmakerAccountError extends Error {
  constructor(readonly code: FilmmakerAccountErrorCode, message: string) {
    super(message);
    this.name = "FilmmakerAccountError";
  }
}

function normalizedEmail(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function storedSubmissionReference(answers: Record<string, unknown>): {
  filmmakerId: number;
  projectId: number | null;
} | null {
  const stored = answers._submission;
  if (!stored || typeof stored !== "object") return null;
  const submission = stored as { filmmaker_id?: unknown; project_id?: unknown };
  if (typeof submission.filmmaker_id !== "number"
    || (submission.project_id !== null && typeof submission.project_id !== "number")) return null;
  return { filmmakerId: submission.filmmaker_id, projectId: submission.project_id };
}

export async function createFilmmakerSubmission(input: {
  visitorId: string;
  firebaseUid?: string;
  replitUid?: string;
  firebaseEmail?: string;
  data: FilmmakerSubmissionData;
}): Promise<{
  filmmakerId: number;
  projectId: number | null;
  discardedDraftMaterials: { paths: string[]; videoId: string | null } | null;
}> {
  return db.transaction(async (tx) => {
    const identityUid = input.firebaseUid ?? input.replitUid;
    const provider = input.firebaseUid ? "firebase" : input.replitUid ? "replit" : null;
    if (identityUid) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${provider} || ':' || ${identityUid}))`);
    }
    const [visitor] = await tx.select().from(visitorsTable)
      .where(eq(visitorsTable.visitorId, input.visitorId))
      .for("update");
    if (!visitor) {
      throw new FilmmakerSubmissionError("Visitor must be recorded before submitting.");
    }
    if (visitor.filmmakerDraftResetAt) {
      throw new FilmmakerSubmissionError("This draft was cleared. Start a fresh worksheet before submitting.");
    }
    const [accountLink] = await tx.select().from(filmmakerAccountVisitorsTable)
      .where(eq(filmmakerAccountVisitorsTable.visitorId, input.visitorId))
      .for("update");
    const accountLinkMatchesIdentity = Boolean(
      accountLink
      && provider === "firebase"
      && accountLink.firebaseUid === identityUid
      && accountLink.replitUid === null,
    ) || Boolean(
      accountLink
      && provider === "replit"
      && accountLink.replitUid === identityUid
      && accountLink.firebaseUid === null,
    );
    if (!accountLinkMatchesIdentity) {
      throw new FilmmakerSubmissionError("This visitor is linked to a different filmmaker account.");
    }
    const accountLinkUid = identityUid;
    const verifiedEmailMatchesContact = Boolean(
      identityUid
      && input.firebaseEmail
      && normalizedEmail(input.firebaseEmail) === normalizedEmail(input.data.email),
    );
    if (identityUid && !verifiedEmailMatchesContact) {
      throw new FilmmakerSubmissionError("The verified account email must match the submitted contact email.");
    }
    if (accountLink && !verifiedEmailMatchesContact) {
      throw new FilmmakerSubmissionError("The verified account email must match the submitted contact email.");
    }
    if (!input.data.no_project_yet && visitor.priceGroup !== "A" && visitor.priceGroup !== "B") {
      throw new FilmmakerSubmissionError("A price group is required before project submission.");
    }

    const [existingProgress] = await tx.select().from(flowProgressTable).where(and(
      eq(flowProgressTable.visitorId, input.visitorId),
      eq(flowProgressTable.flow, "filmmaker"),
    )).for("update");
    const savedStage = existingProgress?.answers.stage;
    if (!existingProgress?.completed && savedStage === "other") {
      throw new FilmmakerSubmissionError(
        "This saved draft uses a retired project stage. Choose idea, production, or distribution before submitting.",
      );
    }
    if (!input.data.no_project_yet) {
      const stage = (input.data as { stage?: unknown }).stage;
      if (stage !== "idea" && stage !== "production" && stage !== "distribution") {
        throw new FilmmakerSubmissionError("A project stage of idea, production, or distribution is required.");
      }
    }

    const [stagedMaterials] = await tx.select().from(filmmakerDraftMaterialsTable)
      .where(eq(filmmakerDraftMaterialsTable.visitorId, input.visitorId))
      .for("update");
    if (existingProgress?.completed) {
      const reference = storedSubmissionReference(existingProgress.answers);
      if (!reference) {
        throw new FilmmakerSubmissionError("A completed submission already exists and cannot be replaced.");
      }
      const [priorFilmmaker] = await tx.select({ id: filmmakersTable.id })
        .from(filmmakersTable)
        .where(and(
          eq(filmmakersTable.id, reference.filmmakerId),
          eq(filmmakersTable.visitorId, input.visitorId),
        ));
      const [priorProject] = reference.projectId === null
        ? [undefined]
        : await tx.select({ id: projectsTable.id }).from(projectsTable).where(and(
          eq(projectsTable.id, reference.projectId),
          eq(projectsTable.filmmakerId, reference.filmmakerId),
        ));
      if (!priorFilmmaker || (reference.projectId !== null && !priorProject)) {
        throw new FilmmakerSubmissionError("A completed submission already exists and cannot be replaced.");
      }
      return {
        filmmakerId: priorFilmmaker.id,
        projectId: priorProject?.id ?? null,
        discardedDraftMaterials: null,
      };
    }

    const accountUid = accountLinkUid;

    const [syncedPhone] = accountUid && provider === "firebase"
      ? await tx.select({ phone: filmmakersTable.phone })
        .from(filmmakersTable)
        .where(and(
          eq(filmmakersTable.firebaseUid, accountUid),
          eq(filmmakersTable.phoneVerified, true),
        ))
        .limit(1)
      : [];
    const [filmmaker] = await tx.insert(filmmakersTable).values({
      name: input.data.name,
      email: input.data.email,
      phone: syncedPhone?.phone ?? input.data.phone,
      phoneVerified: Boolean(syncedPhone),
      city: input.data.city,
      state: input.data.state,
      country: input.data.country,
      favoriteGenres: input.data.favorite_genres,
      chatOptIn: input.data.chat_opt_in,
      noProjectYet: input.data.no_project_yet,
      visitorId: input.visitorId,
      firebaseUid: provider === "firebase" ? accountUid : null,
      replitUid: provider === "replit" ? accountUid : null,
      fundingSources: input.data.funding_sources,
      fundingOther: input.data.funding_other,
      reachedGoal: input.data.reached_goal,
      fundingExperience: input.data.funding_experience,
    }).returning({ id: filmmakersTable.id });

    const submittedAnswers = {
      ...input.data,
      ...(!input.data.no_project_yet && input.data.wants_lower ? { offer_per100: 125 } : {}),
    };
    const [ageConfirmation] = provider && identityUid ? await tx.select({
      confirmed_at: ageConfirmationsTable.confirmedAt,
    }).from(ageConfirmationsTable).where(and(
      eq(ageConfirmationsTable.provider, provider),
      eq(ageConfirmationsTable.uid, identityUid),
    )) : [];
    let projectId: number | null = null;
    const discardedDraftMaterials = input.data.no_project_yet && stagedMaterials
      ? {
        paths: [
          stagedMaterials.posterStoragePath,
          stagedMaterials.shareImageStoragePath,
          stagedMaterials.pitchDeckStoragePath,
        ].filter((path): path is string => typeof path === "string"),
        videoId: stagedMaterials.bunnyVideoId ?? null,
      }
      : null;
    if (!input.data.no_project_yet) {
      const title = input.data.title!;
      const slugBase = title.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "project";
      const [project] = await tx.insert(projectsTable).values({
        filmmakerId: filmmaker.id,
        slug: `${slugBase}-${randomUUID()}`,
        title,
        format: input.data.format,
        genre: input.data.genre,
        genreOther: input.data.genre_other,
        stage: input.data.stage,
        logline: input.data.logline,
        teamInfo: input.data.team_info,
        teamLinks: input.data.team_links,
        moneyUse: input.data.money_use,
        distributionPlan: input.data.distribution_plan,
        crowdfunding: Object.fromEntries(Object.entries(input.data).filter(([key]) => key.startsWith("crowdfunding_"))),
        trailerUrl: stagedMaterials?.trailerUrl ?? input.data.trailer_url,
        pilotUrl: input.data.pilot_url,
        bunnyVideoId: stagedMaterials?.bunnyVideoId ?? null,
        posterUrl: stagedMaterials?.posterUrl ?? null,
        posterStoragePath: stagedMaterials?.posterStoragePath ?? null,
        shareImageUrl: stagedMaterials?.shareImageUrl ?? null,
        shareImageStoragePath: stagedMaterials?.shareImageStoragePath ?? null,
        synopsis: stagedMaterials?.synopsis ?? null,
        pitchDeckStoragePath: stagedMaterials?.pitchDeckStoragePath ?? null,
        pitchDeckName: stagedMaterials?.pitchDeckName ?? null,
        budget: input.data.budget,
        budgetFromExample: input.data.budget_from_example,
        priceGroup: visitor.priceGroup,
        dealAnswer: input.data.deal_answer,
        offerPer100: input.data.wants_lower ? 125 : input.data.offer_per100,
        proposal: input.data.proposal ?? null,
        offerOtherText: input.data.offer_other_text,
        wantsLower: input.data.wants_lower,
        paybackTerms: input.data.payback_terms,
        paybackTermsOther: input.data.payback_terms_other,
      }).returning({ id: projectsTable.id });
      projectId = project.id;
      const [savedProject] = await tx.select().from(projectsTable).where(eq(projectsTable.id, project.id));
      const { submissionSnapshot: _snapshot, reviewNotes: _notes, reviewHistory: _history, ...originalProject } = savedProject;
      await tx.update(projectsTable).set({ submissionSnapshot: {
        submitted_at: savedProject.createdAt.toISOString(),
        answers: submittedAnswers,
        project: originalProject,
        filmmaker: {
          name: input.data.name, email: input.data.email, phone: syncedPhone?.phone ?? input.data.phone ?? null,
          city: input.data.city, state: input.data.state ?? null, country: input.data.country ?? null,
          favorite_genres: input.data.favorite_genres, chat_opt_in: input.data.chat_opt_in,
          email_verified: verifiedEmailMatchesContact, phone_verified: Boolean(syncedPhone),
        },
        age_confirmation: ageConfirmation ? { ...ageConfirmation, self_declaration: true } : null,
      } }).where(eq(projectsTable.id, project.id));
      if (stagedMaterials) {
        await tx.delete(filmmakerDraftMaterialsTable)
          .where(eq(filmmakerDraftMaterialsTable.visitorId, input.visitorId));
      }
    } else if (stagedMaterials) {
      await tx.delete(filmmakerDraftMaterialsTable)
        .where(eq(filmmakerDraftMaterialsTable.visitorId, input.visitorId));
    }

    await tx.insert(flowProgressTable).values({
      visitorId: input.visitorId,
      flow: "filmmaker",
      lastScreen: 6,
      answers: {
        ...(existingProgress?.answers ?? {}),
        ...submittedAnswers,
        _submission: { filmmaker_id: filmmaker.id, project_id: projectId },
      },
      completed: true,
    }).onConflictDoUpdate({
      target: [flowProgressTable.visitorId, flowProgressTable.flow],
      set: {
        lastScreen: 6,
        answers: {
          ...(existingProgress?.answers ?? {}),
          ...submittedAnswers,
          _submission: { filmmaker_id: filmmaker.id, project_id: projectId },
        },
        completed: true,
        updatedAt: new Date(),
      },
    });

    return { filmmakerId: filmmaker.id, projectId, discardedDraftMaterials };
  });
}

export async function claimFilmmakerVisitor(input: {
  visitorId: string;
  firebaseUid?: string;
  replitUid?: string;
  verifiedEmail: string;
  expectedDraftId?: number;
}): Promise<{ submissionClaimed: boolean; projectId: number | null }> {
  return db.transaction(async (tx) => {
    const provider = input.firebaseUid ? "firebase" : "replit";
    const uid = input.firebaseUid ?? input.replitUid;
    if (!uid) throw new FilmmakerAccountError("visitor_owned_by_another_account", "A verified account is required.");
    const ownerColumn = provider === "firebase" ? filmmakerAccountVisitorsTable.firebaseUid : filmmakerAccountVisitorsTable.replitUid;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${provider} || ':' || ${uid}))`);
    const [visitor] = await tx.select().from(visitorsTable)
      .where(eq(visitorsTable.visitorId, input.visitorId))
      .for("update");
    if (!visitor) {
      throw new FilmmakerAccountError("visitor_not_found", "The current visitor record was not found.");
    }

    const [existingLink] = await tx.select().from(filmmakerAccountVisitorsTable)
      .where(eq(filmmakerAccountVisitorsTable.visitorId, input.visitorId))
      .for("update");
    const existingLinkMatchesIdentity = Boolean(
      existingLink
      && provider === "firebase"
      && existingLink.firebaseUid === uid
      && existingLink.replitUid === null,
    ) || Boolean(
      existingLink
      && provider === "replit"
      && existingLink.replitUid === uid
      && existingLink.firebaseUid === null,
    );
    if (existingLink && !existingLinkMatchesIdentity) {
      throw new FilmmakerAccountError("visitor_owned_by_another_account", "This project belongs to a different filmmaker account.");
    }

    const [progress] = await tx.select().from(flowProgressTable).where(and(
      eq(flowProgressTable.visitorId, input.visitorId),
      eq(flowProgressTable.flow, "filmmaker"),
    )).for("update");
    const [draftMaterials] = await tx.select().from(filmmakerDraftMaterialsTable)
      .where(eq(filmmakerDraftMaterialsTable.visitorId, input.visitorId))
      .for("update");

    if (input.expectedDraftId !== undefined && progress?.id !== input.expectedDraftId) {
      throw new FilmmakerAccountError(
        "account_draft_conflict",
        "The filmmaker draft changed before it could be claimed. Refresh this page and try again.",
      );
    }
    if (progress && !progress.completed && input.expectedDraftId === undefined) {
      throw new FilmmakerAccountError(
        "account_draft_conflict",
        "X-MSI-Draft-Id is required to securely claim this unfinished filmmaker draft.",
      );
    }

    if (!existingLink && hasMeaningfulFilmmakerDraft(progress, draftMaterials)) {
      const [activeDraft] = await tx.select({ visitorId: filmmakerAccountVisitorsTable.visitorId })
        .from(filmmakerAccountVisitorsTable)
        .innerJoin(flowProgressTable, and(
          eq(flowProgressTable.visitorId, filmmakerAccountVisitorsTable.visitorId),
          eq(flowProgressTable.flow, "filmmaker"),
          eq(flowProgressTable.completed, false),
        ))
        .where(and(
          eq(ownerColumn, uid),
          ne(filmmakerAccountVisitorsTable.visitorId, input.visitorId),
        ))
        .limit(1);
      if (activeDraft) {
        throw new FilmmakerAccountError(
          "account_draft_conflict",
          "This browser has an unfinished guest draft, and this account already has a different active draft. Resume the account draft or resolve the guest draft before claiming it.",
        );
      }
    }

    let submissionClaimed = false;
    let projectId: number | null = null;
    if (progress?.completed) {
      const reference = storedSubmissionReference(progress.answers);
      if (!reference) {
        throw new FilmmakerAccountError("submission_not_found", "The completed submission could not be verified.");
      }
      const [filmmaker] = await tx.select().from(filmmakersTable).where(and(
        eq(filmmakersTable.id, reference.filmmakerId),
        eq(filmmakersTable.visitorId, input.visitorId),
      )).for("update");
      if (!filmmaker) {
        throw new FilmmakerAccountError("submission_not_found", "The completed submission could not be verified.");
      }
      const filmmakerOwnerUid = provider === "firebase" ? filmmaker.firebaseUid : filmmaker.replitUid;
      if ((filmmaker.firebaseUid && provider !== "firebase") || (filmmaker.replitUid && provider !== "replit")
        || (filmmakerOwnerUid && filmmakerOwnerUid !== uid)) {
        throw new FilmmakerAccountError("visitor_owned_by_another_account", "This project belongs to a different filmmaker account.");
      }
      if (normalizedEmail(filmmaker.email) !== normalizedEmail(input.verifiedEmail)) {
        throw new FilmmakerAccountError("verified_email_mismatch", "The verified account email must match the email on the existing submission.");
      }
      if (reference.projectId !== null) {
        const [project] = await tx.select({ id: projectsTable.id }).from(projectsTable).where(and(
          eq(projectsTable.id, reference.projectId),
          eq(projectsTable.filmmakerId, filmmaker.id),
        ));
        if (!project) {
          throw new FilmmakerAccountError("submission_not_found", "The completed submission could not be verified.");
        }
      } else if (!filmmaker.noProjectYet) {
        throw new FilmmakerAccountError("submission_not_found", "The completed submission could not be verified.");
      }
      const [syncedPhone] = provider === "firebase" ? await tx.select({ phone: filmmakersTable.phone })
        .from(filmmakersTable)
        .where(and(
          eq(filmmakersTable.firebaseUid, uid),
          eq(filmmakersTable.phoneVerified, true),
        ))
        .limit(1) : [];
      if (filmmakerOwnerUid !== uid || syncedPhone) {
        await tx.update(filmmakersTable).set({
          ...(provider === "firebase" ? { firebaseUid: uid } : { replitUid: uid }),
          ...(provider === "firebase"
            ? (syncedPhone ? { phone: syncedPhone.phone, phoneVerified: true } : { phoneVerified: false })
            : {}),
        })
          .where(eq(filmmakersTable.id, filmmaker.id));
      }
      submissionClaimed = true;
      projectId = reference.projectId;
    }

    if (!existingLink) {
      await tx.insert(filmmakerAccountVisitorsTable).values({
        visitorId: input.visitorId,
        firebaseUid: provider === "firebase" ? uid : null,
        replitUid: provider === "replit" ? uid : null,
      }).onConflictDoNothing();
      const [linked] = await tx.select().from(filmmakerAccountVisitorsTable)
        .where(eq(filmmakerAccountVisitorsTable.visitorId, input.visitorId));
      if (!linked || (provider === "firebase" ? linked.firebaseUid : linked.replitUid) !== uid) {
        throw new FilmmakerAccountError("visitor_owned_by_another_account", "This project belongs to a different filmmaker account.");
      }
    }

    return { submissionClaimed, projectId };
  });
}

export async function getFilmmakerAccountVisitorOwner(visitorId: string): Promise<{ provider: "firebase" | "replit"; uid: string } | null> {
  const [link] = await db.select({
    firebaseUid: filmmakerAccountVisitorsTable.firebaseUid,
    replitUid: filmmakerAccountVisitorsTable.replitUid,
  })
    .from(filmmakerAccountVisitorsTable)
    .where(eq(filmmakerAccountVisitorsTable.visitorId, visitorId))
    .limit(1);
  if (link?.firebaseUid) return { provider: "firebase", uid: link.firebaseUid };
  if (link?.replitUid) return { provider: "replit", uid: link.replitUid };
  return null;
}

export async function getInvestorAccountVisitorOwner(visitorId: string): Promise<{
  firebaseUid: string | null;
  replitUid: string | null;
} | null> {
  const [investor] = await db.select({
    firebaseUid: investorsTable.firebaseUid,
    replitUid: investorsTable.replitUid,
  })
    .from(investorsTable)
    .where(eq(investorsTable.visitorId, visitorId))
    .limit(1);
  if (!investor) return null;
  return investor;
}

export async function listFilmmakerAccountProjects(firebaseUid: string, provider: "firebase" | "replit" = "firebase"): Promise<{
  projects: Array<{
    id: number;
    slug: string | null;
    title: string | null;
    reviewState: "pending" | "approved" | "hidden";
    createdAt: Date;
  }>;
  hasResumableDraft: boolean;
  phoneVerified: boolean;
}> {
  const accountColumn = provider === "firebase" ? filmmakersTable.firebaseUid : filmmakersTable.replitUid;
  const visitorOwnerColumn = provider === "firebase" ? filmmakerAccountVisitorsTable.firebaseUid : filmmakerAccountVisitorsTable.replitUid;
  const projects = await db.select({
    id: projectsTable.id,
    slug: projectsTable.slug,
    title: projectsTable.title,
    approved: projectsTable.approved,
    hidden: projectsTable.hidden,
    createdAt: projectsTable.createdAt,
  }).from(projectsTable)
    .innerJoin(filmmakersTable, eq(projectsTable.filmmakerId, filmmakersTable.id))
    .where(eq(accountColumn, firebaseUid))
    .orderBy(desc(projectsTable.createdAt), desc(projectsTable.id));

  const [draft] = await db.select({ visitorId: filmmakerAccountVisitorsTable.visitorId })
    .from(filmmakerAccountVisitorsTable)
    .innerJoin(flowProgressTable, and(
      eq(flowProgressTable.visitorId, filmmakerAccountVisitorsTable.visitorId),
      eq(flowProgressTable.flow, "filmmaker"),
      eq(flowProgressTable.completed, false),
    ))
    .where(eq(visitorOwnerColumn, firebaseUid))
    .limit(1);
  const [verifiedPhone] = await db.select({ id: filmmakersTable.id })
    .from(filmmakersTable)
    .where(and(eq(accountColumn, firebaseUid), eq(filmmakersTable.phoneVerified, true)))
    .limit(1);

  return {
    projects: projects.map((project) => ({
      id: project.id,
      slug: project.slug,
      title: project.title,
      reviewState: project.hidden ? "hidden" : project.approved ? "approved" : "pending",
      createdAt: project.createdAt,
    })),
    hasResumableDraft: Boolean(draft),
    phoneVerified: provider === "firebase" && Boolean(verifiedPhone),
  };
}

export async function syncFilmmakerPhoneVerification(firebaseUid: string, phoneNumber: string | null): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${firebaseUid}))`);
    const rows = await tx.update(filmmakersTable)
      .set(phoneNumber
        ? { phone: phoneNumber, phoneVerified: true }
        : { phoneVerified: false })
      .where(eq(filmmakersTable.firebaseUid, firebaseUid))
      .returning({ id: filmmakersTable.id });
    return rows.length > 0;
  });
}

export async function startOrResumeFilmmakerAccountDraft(input: {
  firebaseUid?: string;
  replitUid?: string;
  currentVisitorId: string | null;
}): Promise<{ visitorId: string; status: "created" | "resumed"; lastScreen: number; updatedAt: Date }> {
  return db.transaction(async (tx) => {
    const provider = input.firebaseUid ? "firebase" : "replit";
    const uid = input.firebaseUid ?? input.replitUid;
    if (!uid) throw new FilmmakerAccountError("visitor_owned_by_another_account", "A verified account is required.");
    const ownerColumn = provider === "firebase" ? filmmakerAccountVisitorsTable.firebaseUid : filmmakerAccountVisitorsTable.replitUid;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${provider} || ':' || ${uid}))`);
    let currentVisitor: typeof visitorsTable.$inferSelect | undefined;
    if (input.currentVisitorId) {
      const [visitor] = await tx.select().from(visitorsTable)
        .where(eq(visitorsTable.visitorId, input.currentVisitorId))
        .for("update");
      if (!visitor) {
        throw new FilmmakerAccountError("visitor_not_found", "The current visitor record was not found.");
      }
      currentVisitor = visitor;
      if (!visitor.filmmakerDraftResetAt) {
      const [link] = await tx.select().from(filmmakerAccountVisitorsTable)
        .where(eq(filmmakerAccountVisitorsTable.visitorId, input.currentVisitorId))
        .for("update");
      if (link && (provider === "firebase" ? link.firebaseUid : link.replitUid) !== uid) {
        throw new FilmmakerAccountError("visitor_owned_by_another_account", "This visitor is linked to a different filmmaker account.");
      }

      const [progress] = await tx.select().from(flowProgressTable).where(and(
        eq(flowProgressTable.visitorId, input.currentVisitorId),
        eq(flowProgressTable.flow, "filmmaker"),
      )).for("update");
      const [draftMaterials] = await tx.select().from(filmmakerDraftMaterialsTable)
        .where(eq(filmmakerDraftMaterialsTable.visitorId, input.currentVisitorId))
        .for("update");
      if (!link && hasMeaningfulFilmmakerDraft(progress, draftMaterials)) {
        const [activeDraft] = await tx.select({ visitorId: filmmakerAccountVisitorsTable.visitorId })
          .from(filmmakerAccountVisitorsTable)
          .innerJoin(flowProgressTable, and(
            eq(flowProgressTable.visitorId, filmmakerAccountVisitorsTable.visitorId),
            eq(flowProgressTable.flow, "filmmaker"),
            eq(flowProgressTable.completed, false),
          ))
          .where(and(
            eq(ownerColumn, uid),
            ne(filmmakerAccountVisitorsTable.visitorId, input.currentVisitorId),
          ))
          .limit(1);
        if (activeDraft) {
          throw new FilmmakerAccountError(
            "account_draft_conflict",
            "This browser has an unfinished guest draft, and this account already has a different active draft. Resume the account draft or resolve the guest draft before starting another project.",
          );
        }
      }
      if (progress?.completed) {
        const reference = storedSubmissionReference(progress.answers);
        const [filmmaker] = reference
          ? await tx.select({
            firebaseUid: filmmakersTable.firebaseUid,
            replitUid: filmmakersTable.replitUid,
          })
            .from(filmmakersTable)
            .where(and(
              eq(filmmakersTable.id, reference.filmmakerId),
              eq(filmmakersTable.visitorId, input.currentVisitorId),
            )).for("update")
          : [undefined];
        if (!filmmaker || (provider === "firebase" ? filmmaker.firebaseUid : filmmaker.replitUid) !== uid || !link) {
          throw new FilmmakerAccountError(
            "completed_submission_unclaimed",
            "Claim the current completed submission before starting another project.",
          );
        }
      } else if (!link) {
        await tx.insert(filmmakerAccountVisitorsTable).values({
          visitorId: input.currentVisitorId,
          firebaseUid: provider === "firebase" ? uid : null,
          replitUid: provider === "replit" ? uid : null,
        }).onConflictDoNothing();
        const [linked] = await tx.select().from(filmmakerAccountVisitorsTable)
          .where(eq(filmmakerAccountVisitorsTable.visitorId, input.currentVisitorId));
        if (!linked || (provider === "firebase" ? linked.firebaseUid : linked.replitUid) !== uid) {
          throw new FilmmakerAccountError("visitor_owned_by_another_account", "This visitor is linked to a different filmmaker account.");
        }
      }
      }
    }
    const [existingDraft] = await tx.select({
      visitorId: filmmakerAccountVisitorsTable.visitorId,
      lastScreen: flowProgressTable.lastScreen,
      updatedAt: flowProgressTable.updatedAt,
    }).from(filmmakerAccountVisitorsTable)
      .innerJoin(flowProgressTable, and(
        eq(flowProgressTable.visitorId, filmmakerAccountVisitorsTable.visitorId),
        eq(flowProgressTable.flow, "filmmaker"),
        eq(flowProgressTable.completed, false),
      ))
      .where(eq(ownerColumn, uid))
      .orderBy(desc(flowProgressTable.updatedAt))
      .limit(1);
    if (existingDraft) {
      return {
        visitorId: existingDraft.visitorId,
        status: "resumed",
        lastScreen: existingDraft.lastScreen,
        updatedAt: existingDraft.updatedAt,
      };
    }

    const linkedVisitors = await tx.select({ priceGroup: visitorsTable.priceGroup })
      .from(filmmakerAccountVisitorsTable)
      .innerJoin(visitorsTable, eq(visitorsTable.visitorId, filmmakerAccountVisitorsTable.visitorId))
      .where(eq(ownerColumn, uid))
      .orderBy(asc(filmmakerAccountVisitorsTable.linkedAt));
    const stableGroup = linkedVisitors.find(({ priceGroup }) => priceGroup === "A" || priceGroup === "B")?.priceGroup
      ?? (currentVisitor?.priceGroup === "A" || currentVisitor?.priceGroup === "B" ? currentVisitor.priceGroup : null);
    const visitorId = randomUUID();
    await tx.insert(visitorsTable).values({ visitorId, priceGroup: stableGroup }).onConflictDoNothing();
    await tx.insert(filmmakerAccountVisitorsTable).values({
      visitorId,
      firebaseUid: provider === "firebase" ? uid : null,
      replitUid: provider === "replit" ? uid : null,
    });
    const [progress] = await tx.insert(flowProgressTable).values({
      visitorId,
      flow: "filmmaker",
      lastScreen: 1,
      answers: {},
      completed: false,
    }).returning({ lastScreen: flowProgressTable.lastScreen, updatedAt: flowProgressTable.updatedAt });
    return {
      visitorId,
      status: "created",
      lastScreen: progress.lastScreen,
      updatedAt: progress.updatedAt,
    };
  });
}

export async function resumeFilmmakerAccountDraft(uid: string, provider: "firebase" | "replit" = "firebase"): Promise<{
  visitorId: string;
  lastScreen: number;
  updatedAt: Date;
} | null> {
  const ownerColumn = provider === "firebase" ? filmmakerAccountVisitorsTable.firebaseUid : filmmakerAccountVisitorsTable.replitUid;
  const [draft] = await db.select({
    visitorId: filmmakerAccountVisitorsTable.visitorId,
    lastScreen: flowProgressTable.lastScreen,
    updatedAt: flowProgressTable.updatedAt,
  }).from(filmmakerAccountVisitorsTable)
    .innerJoin(flowProgressTable, and(
      eq(flowProgressTable.visitorId, filmmakerAccountVisitorsTable.visitorId),
      eq(flowProgressTable.flow, "filmmaker"),
      eq(flowProgressTable.completed, false),
    ))
    .where(eq(ownerColumn, uid))
    .orderBy(desc(flowProgressTable.updatedAt))
    .limit(1);
  return draft ?? null;
}

export async function getFilmmakerAccountProjectVisitor(
  uid: string,
  projectId: number,
  provider: "firebase" | "replit" = "firebase",
): Promise<string | null> {
  const accountColumn = provider === "firebase" ? filmmakersTable.firebaseUid : filmmakersTable.replitUid;
  const ownerColumn = provider === "firebase" ? filmmakerAccountVisitorsTable.firebaseUid : filmmakerAccountVisitorsTable.replitUid;
  const [owner] = await db.select({ visitorId: filmmakersTable.visitorId })
    .from(projectsTable)
    .innerJoin(filmmakersTable, eq(filmmakersTable.id, projectsTable.filmmakerId))
    .innerJoin(filmmakerAccountVisitorsTable, eq(filmmakerAccountVisitorsTable.visitorId, filmmakersTable.visitorId))
    .where(and(
      eq(projectsTable.id, projectId),
      eq(accountColumn, uid),
      eq(ownerColumn, uid),
    ));
  return owner?.visitorId ?? null;
}

export async function updateProjectReview(
  projectId: number,
  changes: { approved?: boolean; hidden?: boolean },
): Promise<{ id: number; approved: boolean; hidden: boolean } | undefined> {
  const [project] = await db.update(schema.projectsTable)
    .set({
      ...changes,
      reviewHistory: sql`coalesce(${schema.projectsTable.reviewHistory}, '[]'::jsonb) || ${JSON.stringify([{ ...changes, action: "Editorial visibility decision", reviewed_at: new Date().toISOString() }])}::jsonb`,
      ...(changes.approved !== undefined ? { reviewDecision: changes.approved ? "approved" : "declined" } : {}),
    })
    .where(eq(schema.projectsTable.id, projectId))
    .returning({
      id: schema.projectsTable.id,
      approved: schema.projectsTable.approved,
      hidden: schema.projectsTable.hidden,
    });
  return project;
}

type FilmmakerSubmissionReference = { filmmaker_id?: unknown; project_id?: unknown };

async function getOwnedCompletedProject(
  visitorId: string,
): Promise<{ filmmakerId: number; projectId: number | null } | null> {
  const progress = await findVisitorFlowProgress(visitorId, "filmmaker");
  if (!progress?.completed) return null;
  const reference = progress.answers._submission;
  if (!reference || typeof reference !== "object") return null;
  const submission = reference as FilmmakerSubmissionReference;
  if (typeof submission.filmmaker_id !== "number"
    || (submission.project_id !== null && typeof submission.project_id !== "number")) return null;
  const [filmmaker] = await db.select({ id: filmmakersTable.id, noProjectYet: filmmakersTable.noProjectYet })
    .from(filmmakersTable)
    .where(and(
      eq(filmmakersTable.id, submission.filmmaker_id),
      eq(filmmakersTable.visitorId, visitorId),
    ));
  if (!filmmaker) return null;
  if (submission.project_id === null) {
    return filmmaker.noProjectYet ? { filmmakerId: filmmaker.id, projectId: null } : null;
  }
  const [project] = await db.select({ id: projectsTable.id })
    .from(projectsTable)
    .where(and(
      eq(projectsTable.id, submission.project_id),
      eq(projectsTable.filmmakerId, filmmaker.id),
    ));
  return project ? { filmmakerId: filmmaker.id, projectId: project.id } : null;
}

export async function getCompletedFilmmakerResult(visitorId: string) {
  const owner = await getOwnedCompletedProject(visitorId);
  if (!owner) return null;
  const progress = await findVisitorFlowProgress(visitorId, "filmmaker");
  if (!progress) return null;
  const [project] = owner.projectId === null
    ? [undefined]
    : await db.select().from(projectsTable).where(and(
      eq(projectsTable.id, owner.projectId),
      eq(projectsTable.filmmakerId, owner.filmmakerId),
    ));
  return { answers: progress.answers, project };
}

export async function updateOwnedFilmmakerShowcase(input: {
  visitorId: string;
  changes: {
    showcase_requested?: boolean;
    synopsis?: string | null;
    public_filmmaker_name?: string | null;
    team_links?: string[] | null;
    team_info?: string | null;
    crowdfunding_ran?: boolean;
    crowdfunding_campaign?: string;
    crowdfunding_same_project?: boolean;
    crowdfunding_goal?: number;
    crowdfunding_raised?: number;
    crowdfunding_obligations?: string;
    money_use?: string | null;
    distribution_plan?: string | null;
    trailer_url?: string | null;
  };
}) {
  const owner = await getOwnedCompletedProject(input.visitorId);
  if (!owner?.projectId) return null;
  return db.transaction(async (tx) => {
    const [project] = await tx.select().from(projectsTable).where(and(
      eq(projectsTable.id, owner.projectId!),
      eq(projectsTable.filmmakerId, owner.filmmakerId),
    )).for("update");
    if (!project) return null;
    const changes: Partial<typeof projectsTable.$inferInsert> = {};
    if (input.changes.showcase_requested !== undefined) changes.showcaseRequested = input.changes.showcase_requested;
    if (input.changes.synopsis !== undefined) changes.synopsis = input.changes.synopsis;
    if (input.changes.public_filmmaker_name !== undefined) changes.publicFilmmakerName = input.changes.public_filmmaker_name?.trim() || null;
    if (input.changes.team_links !== undefined) changes.teamLinks = input.changes.team_links;
    if (input.changes.team_info !== undefined) changes.teamInfo = input.changes.team_info;
    const campaignChanges = Object.fromEntries(Object.entries(input.changes).filter(([key]) => key.startsWith("crowdfunding_")));
    if (Object.keys(campaignChanges).length) changes.crowdfunding = { ...(project.crowdfunding ?? {}), ...campaignChanges };
    if (input.changes.money_use !== undefined) changes.moneyUse = input.changes.money_use;
    if (input.changes.distribution_plan !== undefined) changes.distributionPlan = input.changes.distribution_plan;
    if (input.changes.trailer_url !== undefined) changes.trailerUrl = input.changes.trailer_url;
    const existingContent = {
      public_filmmaker_name: project.publicFilmmakerName,
      synopsis: project.synopsis,
      team_links: project.teamLinks ?? [],
      team_info: project.teamInfo,
      money_use: project.moneyUse,
      distribution_plan: project.distributionPlan,
      trailer_url: project.trailerUrl,
    };
    const hasContentEdit = (changes.crowdfunding !== undefined && JSON.stringify(changes.crowdfunding) !== JSON.stringify(project.crowdfunding))
      || ["public_filmmaker_name", "synopsis", "team_links", "team_info", "money_use", "distribution_plan", "trailer_url"].some((key) => {
      if (!Object.prototype.hasOwnProperty.call(input.changes, key)) return false;
      const field = key as keyof typeof existingContent;
      const changeValue = input.changes[field];
      const normalizedCurrent = existingContent[field] ?? (key === "team_links" ? [] : null);
      const normalizedChange = key === "public_filmmaker_name" ? (changes.publicFilmmakerName ?? null) : key === "team_links" ? (changeValue ?? []) : (changeValue ?? null);
      return JSON.stringify(normalizedCurrent) !== JSON.stringify(normalizedChange);
    });
    if (project.approved && hasContentEdit) {
      changes.approved = false;
      changes.reviewDecision = null;
    }
    const [updated] = await tx.update(projectsTable).set(changes).where(and(
      eq(projectsTable.id, project.id),
      eq(projectsTable.filmmakerId, owner.filmmakerId),
    )).returning();
    return updated;
  });
}

export async function getOwnedFilmmakerMedia(visitorId: string) {
  const owner = await getOwnedCompletedProject(visitorId);
  if (!owner?.projectId) return null;
  const [project] = await db.select({
    id: projectsTable.id,
    slug: projectsTable.slug,
    title: projectsTable.title,
    trailerUrl: projectsTable.trailerUrl,
    bunnyVideoId: projectsTable.bunnyVideoId,
    pendingBunnyVideoId: projectsTable.pendingBunnyVideoId,
    posterUrl: projectsTable.posterUrl,
    shareImageUrl: projectsTable.shareImageUrl,
    posterStoragePath: projectsTable.posterStoragePath,
    shareImageStoragePath: projectsTable.shareImageStoragePath,
    pitchDeckStoragePath: projectsTable.pitchDeckStoragePath,
    pitchDeckName: projectsTable.pitchDeckName,
  }).from(projectsTable).where(and(
    eq(projectsTable.id, owner.projectId),
    eq(projectsTable.filmmakerId, owner.filmmakerId),
  ));
  return project ?? null;
}

export async function setOwnedPendingBunnyVideo(input: {
  visitorId: string;
  videoId: string;
}): Promise<boolean> {
  const owner = await getOwnedCompletedProject(input.visitorId);
  if (!owner?.projectId) return false;
  const [updated] = await db.update(projectsTable)
    .set({ pendingBunnyVideoId: input.videoId })
    .where(and(
      eq(projectsTable.id, owner.projectId),
      eq(projectsTable.filmmakerId, owner.filmmakerId),
    ))
    .returning({ id: projectsTable.id });
  return Boolean(updated);
}

export async function finalizeOwnedBunnyVideo(input: {
  visitorId: string;
  videoId: string;
  trailerUrl: string;
}): Promise<boolean> {
  const owner = await getOwnedCompletedProject(input.visitorId);
  if (!owner?.projectId) return false;
  const [updated] = await db.update(projectsTable)
    .set({
      bunnyVideoId: input.videoId,
      pendingBunnyVideoId: null,
      trailerUrl: input.trailerUrl,
      approved: false,
      reviewDecision: null,
    })
    .where(and(
      eq(projectsTable.id, owner.projectId),
      eq(projectsTable.filmmakerId, owner.filmmakerId),
      eq(projectsTable.pendingBunnyVideoId, input.videoId),
    ))
    .returning({ id: projectsTable.id });
  return Boolean(updated);
}

export async function clearOwnedPendingBunnyVideo(input: {
  visitorId: string;
  videoId: string;
}): Promise<void> {
  const owner = await getOwnedCompletedProject(input.visitorId);
  if (!owner?.projectId) return;
  await db.update(projectsTable)
    .set({ pendingBunnyVideoId: null })
    .where(and(
      eq(projectsTable.id, owner.projectId),
      eq(projectsTable.filmmakerId, owner.filmmakerId),
      eq(projectsTable.pendingBunnyVideoId, input.videoId),
    ));
}

export async function saveOwnedFilmmakerImage(input: {
  visitorId: string;
  kind: "poster" | "share";
  url: string;
  storagePath: string;
}): Promise<boolean> {
  const owner = await getOwnedCompletedProject(input.visitorId);
  if (!owner?.projectId) return false;
  const [updated] = await db.update(projectsTable)
    .set(input.kind === "poster"
      ? { posterUrl: input.url, posterStoragePath: input.storagePath, approved: false, reviewDecision: null }
      : { shareImageUrl: input.url, shareImageStoragePath: input.storagePath, approved: false, reviewDecision: null })
    .where(and(
      eq(projectsTable.id, owner.projectId),
      eq(projectsTable.filmmakerId, owner.filmmakerId),
    ))
    .returning({ id: projectsTable.id });
  return Boolean(updated);
}

export async function removeOwnedFilmmakerImage(input: {
  visitorId: string;
  projectId: number;
  kind: "poster" | "share";
  expectedUrl: string;
  removeStoredObject: () => Promise<void>;
}): Promise<"removed" | "changed" | "not_found"> {
  const owner = await getOwnedCompletedProject(input.visitorId);
  if (!owner?.projectId || owner.projectId !== input.projectId) return "not_found";

  return db.transaction(async (tx) => {
    const [project] = await tx.select({
      posterUrl: projectsTable.posterUrl,
      shareImageUrl: projectsTable.shareImageUrl,
      posterStoragePath: projectsTable.posterStoragePath,
      shareImageStoragePath: projectsTable.shareImageStoragePath,
    }).from(projectsTable).where(and(
      eq(projectsTable.id, input.projectId),
      eq(projectsTable.filmmakerId, owner.filmmakerId),
    )).for("update");
    if (!project) return "not_found";

    const currentUrl = input.kind === "poster" ? project.posterUrl : project.shareImageUrl;
    if (currentUrl !== input.expectedUrl) return "changed";

    // Hold the project row lock while removing the exact object. Concurrent uploads
    // and edits wait until the provider result is known, so a failure can roll back
    // without compensating writes or overwriting a newer review state.
    await input.removeStoredObject();

    const [updated] = await tx.update(projectsTable)
      .set(input.kind === "poster"
        ? { posterUrl: null, posterStoragePath: null, approved: false, reviewDecision: null }
        : { shareImageUrl: null, shareImageStoragePath: null, approved: false, reviewDecision: null })
      .where(and(
        eq(projectsTable.id, input.projectId),
        eq(projectsTable.filmmakerId, owner.filmmakerId),
        input.kind === "poster"
          ? eq(projectsTable.posterUrl, input.expectedUrl)
          : eq(projectsTable.shareImageUrl, input.expectedUrl),
      ))
      .returning({ id: projectsTable.id });
    return updated ? "removed" : "changed";
  });
}

export async function getPublicProjectBySlug(slug: string) {
  const [project] = await db.select({
    budget: projectsTable.budget,
    proposal: projectsTable.proposal,
    id: projectsTable.id,
    slug: projectsTable.slug,
    title: projectsTable.title,
    publicFilmmakerName: projectsTable.publicFilmmakerName,
    format: projectsTable.format,
    genre: projectsTable.genre,
    stage: projectsTable.stage,
    logline: projectsTable.logline,
    synopsis: projectsTable.synopsis,
    teamLinks: projectsTable.teamLinks,
    teamInfo: projectsTable.teamInfo,
    moneyUse: projectsTable.moneyUse,
    distributionPlan: projectsTable.distributionPlan,
    trailerUrl: projectsTable.trailerUrl,
    posterUrl: projectsTable.posterUrl,
    shareImageUrl: projectsTable.shareImageUrl,
    pitchDeckStoragePath: projectsTable.pitchDeckStoragePath,
    pitchDeckName: projectsTable.pitchDeckName,
    approved: projectsTable.approved,
    showcaseRequested: projectsTable.showcaseRequested,
    hidden: projectsTable.hidden,
    phoneVerified: filmmakersTable.phoneVerified,
    firebaseUid: filmmakersTable.firebaseUid,
    replitUid: filmmakersTable.replitUid,
    visitorId: filmmakersTable.visitorId,
  }).from(projectsTable)
    .leftJoin(filmmakersTable, eq(projectsTable.filmmakerId, filmmakersTable.id))
    .where(and(eq(projectsTable.slug, slug), eq(projectsTable.hidden, false)));
  if (!project?.slug || !project.title) return null;
  // An unlisted project page can remain reachable while the project is not
  // eligible for Explore. Do not publish its historical confirmed interest.
  let confirmedPledgeTotal = 0;
  if (project.approved === true && project.showcaseRequested === true
    && ["idea", "production", "distribution"].includes(project.stage ?? "")) {
    const [pledges] = await db.select({ total: sql<number>`coalesce(sum(${schema.pledgesTable.amount}), 0)` })
      .from(schema.pledgesTable)
      .where(and(
        eq(schema.pledgesTable.projectId, project.id),
        eq(schema.pledgesTable.confirmed, true),
      ));
    confirmedPledgeTotal = Number(pledges.total);
  }
  let phoneVerified = Boolean(project.phoneVerified);
  if (!phoneVerified && project.firebaseUid) {
    const [accountPhone] = await db.select({ id: filmmakersTable.id })
      .from(filmmakersTable)
      .where(and(
        eq(filmmakersTable.firebaseUid, project.firebaseUid),
        eq(filmmakersTable.phoneVerified, true),
      ))
      .limit(1);
    phoneVerified = Boolean(accountPhone);
  }
  return {
    id: project.id,
    slug: project.slug,
    title: project.title,
    publicFilmmakerName: project.publicFilmmakerName,
    budget: project.budget,
    proposal: project.proposal,
    format: project.format,
    genre: project.genre,
    stage: project.stage,
    logline: project.logline,
    synopsis: project.synopsis,
    teamLinks: project.teamLinks,
    teamInfo: project.teamInfo,
    moneyUse: project.moneyUse,
    distributionPlan: project.distributionPlan,
    trailerUrl: project.trailerUrl,
    posterUrl: project.posterUrl,
    shareImageUrl: project.shareImageUrl,
    pitchDeckStoragePath: project.pitchDeckStoragePath,
    pitchDeckName: project.pitchDeckName,
    confirmedPledgeTotal,
    approved: project.approved,
    showcaseRequested: Boolean(project.showcaseRequested),
    phoneVerified,
    firebaseUid: project.firebaseUid,
    replitUid: project.replitUid,
    visitorId: project.visitorId,
  };
}

export async function updateMessageVisibility(
  messageId: number,
  hidden: boolean,
): Promise<{ id: number; hidden: boolean } | undefined> {
  const [message] = await db.update(schema.messagesTable)
    .set({ hidden })
    .where(eq(schema.messagesTable.id, messageId))
    .returning({
      id: schema.messagesTable.id,
      hidden: schema.messagesTable.hidden,
    });
  return message;
}
