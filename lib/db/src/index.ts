import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, count, eq, isNull, sql } from "drizzle-orm";
import pg from "pg";
import * as schema from "./schema";
import {
  flowProgressTable,
  filmmakersTable,
  projectsTable,
  visitorsTable,
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

export async function getFilmmakerCount(): Promise<number> {
  const [result] = await db.select({ total: count() }).from(schema.filmmakersTable);
  return result.total;
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
}): Promise<FlowProgressRecord> {
  if (input.flow === "filmmaker") {
    return db.transaction(async (tx) => {
      await tx.select({ visitorId: visitorsTable.visitorId })
        .from(visitorsTable)
        .where(eq(visitorsTable.visitorId, input.visitorId))
        .for("update");

      const [existing] = await tx.select().from(flowProgressTable).where(and(
        eq(flowProgressTable.visitorId, input.visitorId),
        eq(flowProgressTable.flow, "filmmaker"),
      ));
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
  no_project_yet: boolean;
  stage?: "distribution" | "production" | "idea" | "other";
  stage_other?: string;
  title?: string;
  format?: "movie" | "show";
  genre?: "Horror" | "Drama" | "Comedy" | "Thriller" | "Documentary" | "Sci-Fi" | "Other";
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

export async function createFilmmakerSubmission(input: {
  visitorId: string;
  data: FilmmakerSubmissionData;
}): Promise<{ filmmakerId: number; projectId: number | null }> {
  return db.transaction(async (tx) => {
    const [visitor] = await tx.select().from(visitorsTable)
      .where(eq(visitorsTable.visitorId, input.visitorId))
      .for("update");
    if (!visitor) {
      throw new FilmmakerSubmissionError("Visitor must be recorded before submitting.");
    }
    if (!input.data.no_project_yet && visitor.priceGroup !== "A" && visitor.priceGroup !== "B") {
      throw new FilmmakerSubmissionError("A price group is required before project submission.");
    }

    const [existingProgress] = await tx.select().from(flowProgressTable).where(and(
      eq(flowProgressTable.visitorId, input.visitorId),
      eq(flowProgressTable.flow, "filmmaker"),
    ));
    if (existingProgress?.completed) {
      const stored = existingProgress.answers._submission;
      if (stored && typeof stored === "object") {
        const submission = stored as { filmmaker_id?: unknown; project_id?: unknown };
        if (typeof submission.filmmaker_id === "number"
          && (submission.project_id === null || typeof submission.project_id === "number")) {
          const [priorFilmmaker] = await tx.select({ id: filmmakersTable.id })
            .from(filmmakersTable)
            .where(and(
              eq(filmmakersTable.id, submission.filmmaker_id),
              eq(filmmakersTable.visitorId, input.visitorId),
            ));
          const [priorProject] = submission.project_id === null
            ? [undefined]
            : await tx.select({ id: projectsTable.id }).from(projectsTable).where(and(
              eq(projectsTable.id, submission.project_id),
              eq(projectsTable.filmmakerId, submission.filmmaker_id),
            ));
          if (priorFilmmaker && (submission.project_id === null || priorProject)) {
            return {
              filmmakerId: priorFilmmaker.id,
              projectId: priorProject?.id ?? null,
            };
          }
        }
      }
    }

    const [filmmaker] = await tx.insert(filmmakersTable).values({
      name: input.data.name,
      email: input.data.email,
      phone: input.data.phone,
      city: input.data.city,
      state: input.data.state,
      country: input.data.country,
      favoriteGenres: input.data.favorite_genres,
      chatOptIn: input.data.chat_opt_in,
      noProjectYet: input.data.no_project_yet,
      visitorId: input.visitorId,
      fundingSources: input.data.funding_sources,
      fundingOther: input.data.funding_other,
      reachedGoal: input.data.reached_goal,
      fundingExperience: input.data.funding_experience,
    }).returning({ id: filmmakersTable.id });

    const submittedAnswers = {
      ...input.data,
      ...(!input.data.no_project_yet && input.data.wants_lower ? { offer_per100: 125 } : {}),
    };
    let projectId: number | null = null;
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
        stageOther: input.data.stage_other,
        logline: input.data.logline,
        trailerUrl: input.data.trailer_url,
        pilotUrl: input.data.pilot_url,
        budget: input.data.budget,
        budgetFromExample: input.data.budget_from_example,
        priceGroup: visitor.priceGroup,
        dealAnswer: input.data.deal_answer,
        offerPer100: input.data.wants_lower ? 125 : input.data.offer_per100,
        offerOtherText: input.data.offer_other_text,
        wantsLower: input.data.wants_lower,
        paybackTerms: input.data.payback_terms,
        paybackTermsOther: input.data.payback_terms_other,
      }).returning({ id: projectsTable.id });
      projectId = project.id;
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

    return { filmmakerId: filmmaker.id, projectId };
  });
}

export async function updateProjectReview(
  projectId: number,
  changes: { approved?: boolean; hidden?: boolean },
): Promise<{ id: number; approved: boolean; hidden: boolean } | undefined> {
  const [project] = await db.update(schema.projectsTable)
    .set(changes)
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
    team_links?: string[] | null;
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
    if (input.changes.team_links !== undefined) changes.teamLinks = input.changes.team_links;
    if (input.changes.money_use !== undefined) changes.moneyUse = input.changes.money_use;
    if (input.changes.distribution_plan !== undefined) changes.distributionPlan = input.changes.distribution_plan;
    if (input.changes.trailer_url !== undefined) changes.trailerUrl = input.changes.trailer_url;
    const existingContent = {
      synopsis: project.synopsis,
      team_links: project.teamLinks ?? [],
      money_use: project.moneyUse,
      distribution_plan: project.distributionPlan,
      trailer_url: project.trailerUrl,
    };
    const hasContentEdit = ["synopsis", "team_links", "money_use", "distribution_plan", "trailer_url"].some((key) => {
      if (!Object.prototype.hasOwnProperty.call(input.changes, key)) return false;
      const field = key as keyof typeof existingContent;
      const changeValue = input.changes[field];
      const normalizedCurrent = existingContent[field] ?? (key === "team_links" ? [] : null);
      const normalizedChange = key === "team_links" ? (changeValue ?? []) : (changeValue ?? null);
      return JSON.stringify(normalizedCurrent) !== JSON.stringify(normalizedChange);
    });
    if (project.approved && hasContentEdit) changes.approved = false;
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
}): Promise<boolean> {
  const owner = await getOwnedCompletedProject(input.visitorId);
  if (!owner?.projectId) return false;
  const [updated] = await db.update(projectsTable)
    .set(input.kind === "poster"
      ? { posterUrl: input.url, approved: false }
      : { shareImageUrl: input.url, approved: false })
    .where(and(
      eq(projectsTable.id, owner.projectId),
      eq(projectsTable.filmmakerId, owner.filmmakerId),
    ))
    .returning({ id: projectsTable.id });
  return Boolean(updated);
}

export async function getPublicProjectBySlug(slug: string) {
  const [project] = await db.select({
    id: projectsTable.id,
    slug: projectsTable.slug,
    title: projectsTable.title,
    format: projectsTable.format,
    genre: projectsTable.genre,
    stage: projectsTable.stage,
    logline: projectsTable.logline,
    synopsis: projectsTable.synopsis,
    teamLinks: projectsTable.teamLinks,
    moneyUse: projectsTable.moneyUse,
    distributionPlan: projectsTable.distributionPlan,
    trailerUrl: projectsTable.trailerUrl,
    posterUrl: projectsTable.posterUrl,
    shareImageUrl: projectsTable.shareImageUrl,
    approved: projectsTable.approved,
    showcaseRequested: projectsTable.showcaseRequested,
    hidden: projectsTable.hidden,
  }).from(projectsTable).where(and(eq(projectsTable.slug, slug), eq(projectsTable.hidden, false)));
  if (!project?.slug || !project.title) return null;
  const [pledges] = await db.select({ total: sql<number>`coalesce(sum(${schema.pledgesTable.amount}), 0)` })
    .from(schema.pledgesTable)
    .where(and(
      eq(schema.pledgesTable.projectId, project.id),
      eq(schema.pledgesTable.confirmed, true),
    ));
  return {
    slug: project.slug,
    title: project.title,
    format: project.format,
    genre: project.genre,
    stage: project.stage,
    logline: project.logline,
    synopsis: project.synopsis,
    teamLinks: project.teamLinks,
    moneyUse: project.moneyUse,
    distributionPlan: project.distributionPlan,
    trailerUrl: project.trailerUrl,
    posterUrl: project.posterUrl,
    shareImageUrl: project.shareImageUrl,
    confirmedPledgeTotal: Number(pledges.total),
    approved: project.approved,
    showcaseRequested: Boolean(project.showcaseRequested),
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
