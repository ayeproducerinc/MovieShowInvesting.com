import { and, eq } from "drizzle-orm";
import { db, hasMeaningfulFilmmakerDraft } from "./index";
import {
  filmmakerDraftMaterialsTable,
  filmmakerActivityTable,
  filmmakersTable,
  flowProgressTable,
  projectsTable,
  type FilmmakerDraftMaterials,
  type Project,
} from "./schema";

export type FilmmakerMaterialProject = Project & { visitorId: string | null };

async function lockActiveDraft(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], visitorId: string, draftId: number) {
  const [progress] = await tx.select({
    id: flowProgressTable.id,
    answers: flowProgressTable.answers,
  }).from(flowProgressTable).where(and(
    eq(flowProgressTable.id, draftId),
    eq(flowProgressTable.visitorId, visitorId),
    eq(flowProgressTable.flow, "filmmaker"),
    eq(flowProgressTable.completed, false),
  )).for("update");
  return progress;
}

export async function getFilmmakerDraftMaterials(visitorId: string, draftId: number): Promise<FilmmakerDraftMaterials | null> {
  const [progress] = await db.select({ id: flowProgressTable.id, answers: flowProgressTable.answers }).from(flowProgressTable).where(and(
    eq(flowProgressTable.id, draftId),
    eq(flowProgressTable.visitorId, visitorId),
    eq(flowProgressTable.flow, "filmmaker"),
    eq(flowProgressTable.completed, false),
  ));
  if (!progress || progress.answers.no_project_yet === true) return null;
  const [materials] = await db.select().from(filmmakerDraftMaterialsTable)
    .where(eq(filmmakerDraftMaterialsTable.visitorId, visitorId));
  return materials ?? {
    visitorId,
    synopsis: null,
    trailerUrl: null,
    bunnyVideoId: null,
    posterUrl: null,
    posterStoragePath: null,
    shareImageUrl: null,
    shareImageStoragePath: null,
    pitchDeckStoragePath: null,
    pitchDeckName: null,
    updatedAt: new Date(0),
  };
}

export async function updateFilmmakerDraftText(input: {
  visitorId: string;
  draftId: number;
  synopsis?: string | null;
  trailerUrl?: string | null;
}): Promise<{ materials: FilmmakerDraftMaterials; previousVideoId: string | null } | null> {
  return db.transaction(async (tx) => {
    const progress = await lockActiveDraft(tx, input.visitorId, input.draftId);
    if (!progress || progress.answers.no_project_yet === true) return null;
    const [current] = await tx.select().from(filmmakerDraftMaterialsTable)
      .where(eq(filmmakerDraftMaterialsTable.visitorId, input.visitorId)).for("update");
    const changes: Partial<typeof filmmakerDraftMaterialsTable.$inferInsert> = {};
    if (input.synopsis !== undefined) changes.synopsis = input.synopsis;
    if (input.trailerUrl !== undefined) {
      changes.trailerUrl = input.trailerUrl;
      changes.bunnyVideoId = null;
    }
    const [materials] = await tx.insert(filmmakerDraftMaterialsTable).values({
      visitorId: input.visitorId,
      ...changes,
    }).onConflictDoUpdate({
      target: filmmakerDraftMaterialsTable.visitorId,
      set: { ...changes, updatedAt: new Date() },
    }).returning();
    if (hasMeaningfulFilmmakerDraft({ ...progress, completed: false }, materials)) {
      await tx.insert(filmmakerActivityTable).values({
        identityKey: `visitor:${input.visitorId}`, visitorId: input.visitorId,
      }).onConflictDoNothing();
    }
    return { materials, previousVideoId: input.trailerUrl !== undefined ? current?.bunnyVideoId ?? null : null };
  });
}

export type DraftMaterialAssetUpdate =
  | { kind: "poster"; url: string; storagePath: string }
  | { kind: "share"; url: string; storagePath: string }
  | { kind: "trailer"; url: string; videoId: string }
  | { kind: "pitch-deck"; storagePath: string; name: string };

export async function saveFilmmakerDraftAsset(input: {
  visitorId: string;
  draftId: number;
  asset: DraftMaterialAssetUpdate;
}): Promise<{ materials: FilmmakerDraftMaterials; previousPath: string | null; previousVideoId: string | null } | null> {
  return db.transaction(async (tx) => {
    const progress = await lockActiveDraft(tx, input.visitorId, input.draftId);
    if (!progress) return null;
    if (progress.answers.no_project_yet === true) return null;
    const [current] = await tx.select().from(filmmakerDraftMaterialsTable)
      .where(eq(filmmakerDraftMaterialsTable.visitorId, input.visitorId)).for("update");
    let changes: Partial<typeof filmmakerDraftMaterialsTable.$inferInsert>;
    let previousPath: string | null = null;
    let previousVideoId: string | null = null;
    switch (input.asset.kind) {
      case "poster":
        changes = { posterUrl: input.asset.url, posterStoragePath: input.asset.storagePath };
        previousPath = current?.posterStoragePath ?? null;
        break;
      case "share":
        changes = { shareImageUrl: input.asset.url, shareImageStoragePath: input.asset.storagePath };
        previousPath = current?.shareImageStoragePath ?? null;
        break;
      case "trailer":
        changes = { trailerUrl: input.asset.url, bunnyVideoId: input.asset.videoId };
        previousVideoId = current?.bunnyVideoId ?? null;
        break;
      case "pitch-deck":
        changes = { pitchDeckStoragePath: input.asset.storagePath, pitchDeckName: input.asset.name };
        previousPath = current?.pitchDeckStoragePath ?? null;
        break;
    }
    const [materials] = await tx.insert(filmmakerDraftMaterialsTable).values({
      visitorId: input.visitorId,
      ...changes,
    }).onConflictDoUpdate({
      target: filmmakerDraftMaterialsTable.visitorId,
      set: { ...changes, updatedAt: new Date() },
    }).returning();
    if (hasMeaningfulFilmmakerDraft({ ...progress, completed: false }, materials)) {
      await tx.insert(filmmakerActivityTable).values({
        identityKey: `visitor:${input.visitorId}`, visitorId: input.visitorId,
      }).onConflictDoNothing();
    }
    return { materials, previousPath, previousVideoId };
  });
}

export async function removeFilmmakerDraftAsset(input: {
  visitorId: string;
  draftId: number;
  kind: "poster" | "share" | "trailer" | "pitch-deck";
}): Promise<{ materials: FilmmakerDraftMaterials; removedPath: string | null; removedVideoId: string | null } | null> {
  return db.transaction(async (tx) => {
    const progress = await lockActiveDraft(tx, input.visitorId, input.draftId);
    if (!progress || progress.answers.no_project_yet === true) return null;
    const [current] = await tx.select().from(filmmakerDraftMaterialsTable)
      .where(eq(filmmakerDraftMaterialsTable.visitorId, input.visitorId)).for("update");
    const changes: Partial<typeof filmmakerDraftMaterialsTable.$inferInsert> = {};
    let removedPath: string | null = null;
    let removedVideoId: string | null = null;
    switch (input.kind) {
      case "poster":
        removedPath = current?.posterStoragePath ?? null;
        changes.posterUrl = null;
        changes.posterStoragePath = null;
        break;
      case "share":
        removedPath = current?.shareImageStoragePath ?? null;
        changes.shareImageUrl = null;
        changes.shareImageStoragePath = null;
        break;
      case "trailer":
        removedVideoId = current?.bunnyVideoId ?? null;
        changes.trailerUrl = null;
        changes.bunnyVideoId = null;
        break;
      case "pitch-deck":
        removedPath = current?.pitchDeckStoragePath ?? null;
        changes.pitchDeckStoragePath = null;
        changes.pitchDeckName = null;
        break;
    }
    const [materials] = await tx.insert(filmmakerDraftMaterialsTable).values({
      visitorId: input.visitorId,
      ...changes,
    }).onConflictDoUpdate({
      target: filmmakerDraftMaterialsTable.visitorId,
      set: { ...changes, updatedAt: new Date() },
    }).returning();
    return { materials, removedPath, removedVideoId };
  });
}

export async function getFilmmakerProjectMaterials(
  provider: "firebase" | "replit",
  uid: string,
  projectId: number,
): Promise<FilmmakerMaterialProject | null> {
  const ownerColumn = provider === "firebase" ? filmmakersTable.firebaseUid : filmmakersTable.replitUid;
  const [project] = await db.select({
    project: projectsTable,
    visitorId: filmmakersTable.visitorId,
  }).from(projectsTable)
    .innerJoin(filmmakersTable, eq(projectsTable.filmmakerId, filmmakersTable.id))
    .where(and(eq(projectsTable.id, projectId), eq(ownerColumn, uid)));
  return project ? { ...project.project, visitorId: project.visitorId } : null;
}

export type ProjectMaterialAssetUpdate =
  | { kind: "poster"; url: string; storagePath: string }
  | { kind: "share"; url: string; storagePath: string }
  | { kind: "trailer"; url: string; videoId: string }
  | { kind: "pitch-deck"; storagePath: string; name: string };

export async function saveFilmmakerProjectAsset(input: {
  provider: "firebase" | "replit";
  uid: string;
  projectId: number;
  asset: ProjectMaterialAssetUpdate;
}): Promise<{ project: Project; previousPath: string | null; previousVideoId: string | null } | null> {
  return db.transaction(async (tx) => {
    const ownerColumn = input.provider === "firebase" ? filmmakersTable.firebaseUid : filmmakersTable.replitUid;
    const [project] = await tx.select({ project: projectsTable }).from(projectsTable)
      .innerJoin(filmmakersTable, eq(projectsTable.filmmakerId, filmmakersTable.id))
      .where(and(eq(projectsTable.id, input.projectId), eq(ownerColumn, input.uid)))
      .for("update");
    if (!project) return null;
    const changes: Partial<typeof projectsTable.$inferInsert> = {};
    let previousPath: string | null = null;
    let previousVideoId: string | null = null;
    switch (input.asset.kind) {
      case "poster":
        changes.posterUrl = input.asset.url;
        changes.posterStoragePath = input.asset.storagePath;
        previousPath = project.project.posterStoragePath ?? null;
        break;
      case "share":
        changes.shareImageUrl = input.asset.url;
        changes.shareImageStoragePath = input.asset.storagePath;
        previousPath = project.project.shareImageStoragePath ?? null;
        break;
      case "trailer":
        changes.trailerUrl = input.asset.url;
        changes.bunnyVideoId = input.asset.videoId;
        previousVideoId = project.project.bunnyVideoId ?? null;
        break;
      case "pitch-deck":
        changes.pitchDeckStoragePath = input.asset.storagePath;
        changes.pitchDeckName = input.asset.name;
        previousPath = project.project.pitchDeckStoragePath ?? null;
        break;
    }
    if (project.project.approved) {
      changes.approved = false;
      changes.reviewDecision = null;
    }
    const [updated] = await tx.update(projectsTable).set(changes)
      .where(eq(projectsTable.id, input.projectId)).returning();
    return { project: updated, previousPath, previousVideoId };
  });
}

export async function updateFilmmakerProjectTextMaterials(input: {
  provider: "firebase" | "replit";
  uid: string;
  projectId: number;
  synopsis?: string | null;
  trailerUrl?: string | null;
}): Promise<{ project: Project; previousVideoId: string | null } | null> {
  return db.transaction(async (tx) => {
    const ownerColumn = input.provider === "firebase" ? filmmakersTable.firebaseUid : filmmakersTable.replitUid;
    const [current] = await tx.select({ project: projectsTable }).from(projectsTable)
      .innerJoin(filmmakersTable, eq(projectsTable.filmmakerId, filmmakersTable.id))
      .where(and(eq(projectsTable.id, input.projectId), eq(ownerColumn, input.uid)))
      .for("update");
    if (!current) return null;
    const changes: Partial<typeof projectsTable.$inferInsert> = {};
    if (input.synopsis !== undefined) changes.synopsis = input.synopsis;
    if (input.trailerUrl !== undefined) {
      changes.trailerUrl = input.trailerUrl;
      changes.bunnyVideoId = null;
    }
    const changed = (input.synopsis !== undefined && input.synopsis !== current.project.synopsis)
      || (input.trailerUrl !== undefined && input.trailerUrl !== current.project.trailerUrl);
    if (current.project.approved && changed) {
      changes.approved = false;
      changes.reviewDecision = null;
    }
    const [project] = await tx.update(projectsTable).set(changes)
      .where(eq(projectsTable.id, input.projectId)).returning();
    return { project, previousVideoId: input.trailerUrl !== undefined ? current.project.bunnyVideoId : null };
  });
}

export async function removeFilmmakerProjectAsset(input: {
  provider: "firebase" | "replit";
  uid: string;
  projectId: number;
  kind: "poster" | "share" | "trailer" | "pitch-deck";
}): Promise<{ project: Project; removedPath: string | null; removedVideoId: string | null } | null> {
  return db.transaction(async (tx) => {
    const ownerColumn = input.provider === "firebase" ? filmmakersTable.firebaseUid : filmmakersTable.replitUid;
    const [current] = await tx.select({ project: projectsTable }).from(projectsTable)
      .innerJoin(filmmakersTable, eq(projectsTable.filmmakerId, filmmakersTable.id))
      .where(and(eq(projectsTable.id, input.projectId), eq(ownerColumn, input.uid)))
      .for("update");
    if (!current) return null;
    const changes: Partial<typeof projectsTable.$inferInsert> = {};
    let removedPath: string | null = null;
    let removedVideoId: string | null = null;
    let changed = false;
    switch (input.kind) {
      case "poster":
        removedPath = current.project.posterStoragePath ?? null;
        changed = current.project.posterUrl !== null || removedPath !== null;
        changes.posterUrl = null;
        changes.posterStoragePath = null;
        break;
      case "share":
        removedPath = current.project.shareImageStoragePath ?? null;
        changed = current.project.shareImageUrl !== null || removedPath !== null;
        changes.shareImageUrl = null;
        changes.shareImageStoragePath = null;
        break;
      case "trailer":
        removedVideoId = current.project.bunnyVideoId ?? null;
        changed = current.project.trailerUrl !== null || removedVideoId !== null;
        changes.trailerUrl = null;
        changes.bunnyVideoId = null;
        break;
      case "pitch-deck":
        removedPath = current.project.pitchDeckStoragePath ?? null;
        changed = removedPath !== null || current.project.pitchDeckName !== null;
        changes.pitchDeckStoragePath = null;
        changes.pitchDeckName = null;
        break;
    }
    if (current.project.approved && changed) {
      changes.approved = false;
      changes.reviewDecision = null;
    }
    const [project] = await tx.update(projectsTable).set(changes)
      .where(eq(projectsTable.id, input.projectId)).returning();
    return { project, removedPath, removedVideoId };
  });
}

export async function getAdminFilmmakerPitch(projectId: number) {
  const [result] = await db.select({
    project: projectsTable,
    filmmaker: filmmakersTable,
  }).from(projectsTable)
    .leftJoin(filmmakersTable, eq(projectsTable.filmmakerId, filmmakersTable.id))
    .where(eq(projectsTable.id, projectId));
  if (!result) return null;
  const [progress] = result.filmmaker?.visitorId
    ? await db.select({ answers: flowProgressTable.answers }).from(flowProgressTable).where(and(
      eq(flowProgressTable.visitorId, result.filmmaker.visitorId),
      eq(flowProgressTable.flow, "filmmaker"),
    ))
    : [];
  const reference = progress?.answers?._submission as { project_id?: unknown } | undefined;
  const original = result.project.submissionSnapshot?.answers as Record<string, unknown> | undefined;
  const matchingLegacyAnswers = reference?.project_id === result.project.id ? progress?.answers : null;
  return {
    project: result.project, filmmaker: result.filmmaker,
    answers: original ?? matchingLegacyAnswers ?? {},
    provenance: original ? "Preserved project-specific submission" : matchingLegacyAnswers
      ? "Legacy answers linked to this pitch; original edit history was not recorded"
      : "Historical project-specific answers unavailable; current project fields only",
  };
}