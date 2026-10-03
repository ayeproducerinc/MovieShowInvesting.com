import { randomUUID } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { finished } from "node:stream/promises";
import cookieParser from "cookie-parser";
import express, { Router, type IRouter, type NextFunction, type Request, type Response as ExpressResponse } from "express";
import sharp from "sharp";
import {
  pool,
  findVisitorFlowProgress,
  getAdminFilmmakerPitch,
  getFilmmakerDraftMaterials,
  getFilmmakerProjectMaterials,
  removeFilmmakerDraftAsset,
  removeFilmmakerProjectAsset,
  saveFilmmakerDraftAsset,
  saveFilmmakerProjectAsset,
  updateFilmmakerProjectTextMaterials,
  updateFilmmakerDraftText,
} from "@workspace/db";
import {
  DeleteFilmmakerDraftMaterialParams,
  DeleteFilmmakerDraftMaterialResponse,
  DeleteFilmmakerProjectMaterialParams,
  DeleteFilmmakerProjectMaterialResponse,
  GetFilmmakerDraftMaterialsResponse,
  GetFilmmakerProjectMaterialsResponse,
  UpdateFilmmakerDraftMaterialsBody,
  UpdateFilmmakerDraftMaterialsResponse,
  UpdateFilmmakerProjectMaterialsBody,
  UpdateFilmmakerProjectMaterialsResponse,
  UploadFilmmakerDraftImageQueryParams,
  UploadFilmmakerDraftImageResponse,
  UploadFilmmakerDraftPitchDeckResponse,
  UploadFilmmakerDraftTrailerResponse,
  UploadFilmmakerProjectImageQueryParams,
  UploadFilmmakerProjectImageResponse,
  UploadFilmmakerProjectPitchDeckResponse,
  UploadFilmmakerProjectTrailerResponse,
} from "@workspace/api-zod";
import { authorizeAdminIdentity } from "../lib/admin-auth";
import { logger } from "../lib/logger";
import {
  authenticateFilmmaker,
  authorizeFilmmakerVisitor,
  requireMatchingFilmmakerContext,
  type FilmmakerIdentity,
} from "../lib/filmmaker-auth";

const router: IRouter = Router();
router.use(cookieParser());

const VISITOR_COOKIE = "msi_visitor_id";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TRAILER_BYTES = 500 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_DECK_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_ACTIVE_UPLOADS = 4;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const TRAILER_TYPES = ["video/mp4", "video/webm", "video/quicktime"] as const;
const ACCEPTED_VIDEO_STATUSES = new Set([1, 2, 3, 4, 7, 8]);
const STORAGE_FOLDER = "Movie Show Investing folder";
const activeUploadOwners = new Set<string>();
const contextByRequest = new WeakMap<Request, UploadContext>();

type BunnyConfig = {
  streamKey: string;
  libraryId: string;
  collectionId: string;
  storageKey: string;
  storageZone: string;
  storageHost: string;
  cdnBaseUrl: string;
};
type UploadContext =
  | { type: "draft"; visitorId: string; draftId: number; ownerKey: string }
  | { type: "project"; identity: FilmmakerIdentity; projectId: number; visitorId: string | null; ownerKey: string };

class RouteError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
  }
}

function readConfig(): { stream: BunnyConfig | null; storage: BunnyConfig | null } {
  const storageHosts = new Set([
    "storage.bunnycdn.com", "ny.storage.bunnycdn.com", "la.storage.bunnycdn.com",
    "sg.storage.bunnycdn.com", "syd.storage.bunnycdn.com", "uk.storage.bunnycdn.com",
    "se.storage.bunnycdn.com", "br.storage.bunnycdn.com", "jh.storage.bunnycdn.com",
  ]);
  const streamKey = process.env.BUNNY_STREAM_API_KEY?.trim();
  const libraryId = process.env.BUNNY_STREAM_LIBRARY_ID?.trim();
  const collectionId = process.env.BUNNY_STREAM_COLLECTION_ID?.trim();
  const storageKey = process.env.BUNNY_STORAGE_API_KEY?.trim();
  const storageZone = process.env.BUNNY_STORAGE_ZONE?.trim();
  const rawStorageHost = process.env.BUNNY_STORAGE_HOST?.trim();
  const rawCdnBaseUrl = process.env.BUNNY_CDN_BASE_URL?.trim();
  let storageHost: string | null = null;
  let cdnBaseUrl: string | null = null;
  try {
    const parsed = new URL(rawStorageHost?.includes("://") ? rawStorageHost : `https://${rawStorageHost}`);
    if (parsed.protocol === "https:" && !parsed.username && !parsed.password
      && parsed.pathname === "/" && !parsed.search && !parsed.hash
      && storageHosts.has(parsed.hostname.toLowerCase())) storageHost = parsed.hostname.toLowerCase();
  } catch {
    storageHost = null;
  }
  try {
    const parsed = new URL(rawCdnBaseUrl ?? "");
    if (parsed.protocol === "https:" && parsed.hostname && !parsed.username && !parsed.password
      && !parsed.search && !parsed.hash) cdnBaseUrl = parsed.toString().replace(/\/+$/, "");
  } catch {
    cdnBaseUrl = null;
  }
  const stream = streamKey && libraryId && collectionId && UUID.test(collectionId)
    ? { streamKey, libraryId, collectionId, storageKey: "", storageZone: "", storageHost: "", cdnBaseUrl: "" }
    : null;
  const storage = storageKey && storageZone && storageHost && cdnBaseUrl
    ? { streamKey: "", libraryId: "", collectionId: "", storageKey, storageZone, storageHost, cdnBaseUrl }
    : null;
  return { stream, storage };
}

function visitorId(req: Request): string | null {
  const id = req.cookies?.[VISITOR_COOKIE];
  return typeof id === "string" && UUID.test(id) ? id : null;
}

function numericHeader(req: Request, name: string): number | null {
  const raw = req.get(name);
  if (!raw || !/^[1-9][0-9]*$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

function numericQuery(req: Request, name: string): number | null {
  const raw = typeof req.query[name] === "string" ? req.query[name] as string : "";
  if (!/^[1-9][0-9]*$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

function publicStoragePath(owner: UploadContext, filename: string): string {
  if (owner.type === "draft") {
    return `${STORAGE_FOLDER}/filmmaker-drafts/${owner.visitorId}/${filename}`;
  }
  return owner.visitorId
    ? `${STORAGE_FOLDER}/filmmaker-drafts/${owner.visitorId}/${filename}`
    : `${STORAGE_FOLDER}/filmmakers/${owner.projectId}/${filename}`;
}

function storagePathIsSafe(path: string, owner?: UploadContext): boolean {
  const match = path.match(/^Movie Show Investing folder\/(filmmaker-drafts\/([0-9a-f-]{36})|filmmakers\/([1-9][0-9]*))\/([0-9a-f-]{36})\.(jpg|png|webp|pdf)$/i);
  if (!match || !UUID.test(match[4])) return false;
  if (!owner) return true;
  if (owner.type === "draft") {
    return path.startsWith(`${STORAGE_FOLDER}/filmmaker-drafts/${owner.visitorId}/`);
  }
  return (owner.visitorId !== null && path.startsWith(`${STORAGE_FOLDER}/filmmaker-drafts/${owner.visitorId}/`))
    || path.startsWith(`${STORAGE_FOLDER}/filmmakers/${owner.projectId}/`);
}

function storageUrl(config: BunnyConfig, path: string): string {
  if (!storagePathIsSafe(path)) throw new RouteError(400, "The stored media path is invalid.");
  return `https://${config.storageHost}/${encodeURIComponent(config.storageZone)}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

function cdnUrl(config: BunnyConfig, path: string): string {
  return `${config.cdnBaseUrl}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

async function providerRequest(url: string, init: RequestInit, timeoutMs = 12000): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

async function deleteStoredObject(config: BunnyConfig, path: string, owner: UploadContext): Promise<boolean> {
  if (!storagePathIsSafe(path, owner)) return false;
  const evidence = await pool.query(
    `select 1 from projects where submission_snapshot->'project'->>'posterStoragePath'=$1
     or submission_snapshot->'project'->>'shareImageStoragePath'=$1
     or submission_snapshot->'project'->>'pitchDeckStoragePath'=$1 limit 1`, [path],
  );
  if (evidence.rows.length) return true; // Remove from current UI, retain protected original review evidence.
  const response = await providerRequest(storageUrl(config, path), {
    method: "DELETE",
    headers: { AccessKey: config.storageKey },
  });
  await response.body?.cancel().catch(() => undefined);
  if (!response.ok && response.status !== 404) throw new RouteError(502, "Bunny Storage could not remove the replaced file.");
  return true;
}

async function deleteCreatedObject(config: BunnyConfig, path: string, owner: UploadContext): Promise<void> {
  try {
    await deleteStoredObject(config, path, owner);
  } catch {
    logger.warn("Bunny Storage cleanup failed for a newly created project media object.");
  }
}

async function deleteCreatedVideo(config: BunnyConfig, videoId: string): Promise<void> {
  if (!UUID.test(videoId)) return;
  const evidence = await pool.query("select 1 from projects where submission_snapshot->'project'->>'bunnyVideoId'=$1 limit 1", [videoId]);
  if (evidence.rows.length) return;
  try {
    const response = await providerRequest(
      `https://video.bunnycdn.com/library/${encodeURIComponent(config.libraryId)}/videos/${encodeURIComponent(videoId)}`,
      { method: "DELETE", headers: { AccessKey: config.streamKey } },
    );
    await response.body?.cancel().catch(() => undefined);
  } catch {
    logger.warn("Bunny Stream cleanup failed for a newly created project video.");
  }
}

function safeFilename(raw: string | undefined, extension?: string): string | null {
  if (!raw || raw.length > 200 || /[\r\n\0]/.test(raw)) return null;
  const name = raw.replace(/\\/g, "/").split("/").pop()?.trim().replace(/[<>:"|?*\u0000-\u001f\u007f]/g, "_");
  if (!name) return null;
  let result = name.slice(0, 180);
  if (extension) {
    const suffix = `.${extension}`;
    result = result.replace(/\.[^.]*$/, "");
    result = `${result.slice(0, 175)}${suffix}`;
  }
  return result || null;
}

function fileContentLength(req: Request, maximum: number, label: string): number {
  const raw = req.get("content-length");
  if (raw === undefined) throw new RouteError(411, "Content-Length is required for this upload.");
  if (!/^[1-9][0-9]*$/.test(raw)) throw new RouteError(400, "Content-Length must be a positive integer.");
  const size = Number(raw);
  if (!Number.isSafeInteger(size) || size <= 0) throw new RouteError(400, "Content-Length must be a positive integer.");
  if (size > maximum) throw new RouteError(413, `${label} exceeds the ${maximum === MAX_DECK_BYTES ? "20 MB" : maximum === MAX_IMAGE_BYTES ? "10 MB" : "500 MB"} limit.`);
  return size;
}

function contentType(req: Request): string {
  return (req.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

function imageFormat(value: string | undefined): string | null {
  if (value === "jpeg") return "image/jpeg";
  if (value === "png") return "image/png";
  if (value === "webp") return "image/webp";
  return null;
}

function isTrailerBytes(input: Buffer, type: string): boolean {
  if (type === "video/webm") return input.length >= 4 && input.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (type === "video/mp4" || type === "video/quicktime") {
    return input.length >= 12 && input.toString("ascii", 4, 8) === "ftyp";
  }
  return false;
}

function validTrailerLink(value: string | null): boolean {
  if (value === null) return true;
  if (value.length > 2048) return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

async function resolveUploadContext(req: Request, res: ExpressResponse): Promise<UploadContext | null> {
  if (req.path.startsWith("/filmmakers/draft-materials")) {
    const visitor = visitorId(req);
    if (!visitor) {
      res.status(400).json({ error: "A recorded visitor cookie is required." });
      return null;
    }
    const draftId = numericHeader(req, "X-MSI-Draft-Id");
    if (draftId === null) {
      res.status(409).json({ error: "X-MSI-Draft-Id is missing or invalid. Refresh the current draft before retrying." });
      return null;
    }
    const access = await authorizeFilmmakerVisitor(req, res, visitor);
    if (!access.allowed) return null;
    const progress = await findVisitorFlowProgress(visitor, "filmmaker");
    if (!progress || progress.completed) {
      res.status(404).json({ error: "No active filmmaker draft was found." });
      return null;
    }
    if (!requireMatchingFilmmakerContext(req, res, "X-MSI-Draft-Id", progress.id, "draft")) return null;
    if (progress.answers.no_project_yet === true) {
      res.status(404).json({ error: "Optional materials are unavailable when no project is selected." });
      return null;
    }
    return { type: "draft", visitorId: visitor, draftId, ownerKey: `draft:${visitor}:${draftId}` };
  }

  const identity = await authenticateFilmmaker(req, res, true);
  if (!identity) return null;
  const projectId = numericHeader(req, "X-MSI-Project-Id");
  if (projectId === null) {
    res.status(400).json({ error: "X-MSI-Project-Id is required." });
    return null;
  }
  const project = await getFilmmakerProjectMaterials(identity.provider, identity.uid, projectId);
  if (!project) {
    res.status(403).json({ error: "This project is not available to the signed-in filmmaker account." });
    return null;
  }
  return {
    type: "project",
    identity,
    projectId,
    visitorId: project.visitorId,
    ownerKey: `${identity.provider}:${identity.uid}:project:${projectId}`,
  };
}

function reserveUpload(req: Request, res: ExpressResponse, next: NextFunction): void {
  void (async () => {
    const context = await resolveUploadContext(req, res);
    if (!context) return;
    if (activeUploadOwners.has(context.ownerKey) || activeUploadOwners.size >= MAX_ACTIVE_UPLOADS) {
      res.status(429).json({ error: "An upload for this draft or project is already active, or server upload capacity is reached." });
      return;
    }
    const filename = req.get("X-MSI-Filename");
    if (!filename || filename.length > 200 || /[\r\n\0]/.test(filename)) {
      res.status(400).json({ error: "X-MSI-Filename must contain a safe filename no longer than 200 characters." });
      return;
    }
    activeUploadOwners.add(context.ownerKey);
    contextByRequest.set(req, context);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      activeUploadOwners.delete(context.ownerKey);
    };
    res.once("finish", release);
    res.once("close", release);
    next();
  })().catch(next);
}

function contextFor(req: Request): UploadContext | null {
  return contextByRequest.get(req) ?? null;
}

function makeSnapshot(materials: {
  synopsis: string | null;
  trailerUrl: string | null;
  posterUrl: string | null;
  shareImageUrl: string | null;
  pitchDeckStoragePath: string | null;
  pitchDeckName: string | null;
}, deckUrl: string): {
  synopsis: string | null;
  trailer_url: string | null;
  poster_url: string | null;
  share_image_url: string | null;
  pitch_deck_url: string | null;
  pitch_deck_name: string | null;
} {
  return {
    synopsis: materials.synopsis,
    trailer_url: materials.trailerUrl,
    poster_url: materials.posterUrl,
    share_image_url: materials.shareImageUrl,
    pitch_deck_url: materials.pitchDeckStoragePath ? deckUrl : null,
    pitch_deck_name: materials.pitchDeckName,
  };
}

function draftSnapshot(draftId: number, materials: Awaited<ReturnType<typeof getFilmmakerDraftMaterials>>) {
  return makeSnapshot(materials!, `/api/filmmakers/draft-materials/pitch-deck?draft_id=${draftId}`);
}

function projectSnapshot(projectId: number, project: NonNullable<Awaited<ReturnType<typeof getFilmmakerProjectMaterials>>>) {
  return makeSnapshot(project, `/api/filmmakers/project-materials/pitch-deck?project_id=${projectId}`);
}

async function currentDraftSnapshot(context: Extract<UploadContext, { type: "draft" }>) {
  const materials = await getFilmmakerDraftMaterials(context.visitorId, context.draftId);
  if (!materials) return null;
  return draftSnapshot(context.draftId, materials);
}

async function currentProjectSnapshot(context: Extract<UploadContext, { type: "project" }>) {
  const project = await getFilmmakerProjectMaterials(context.identity.provider, context.identity.uid, context.projectId);
  return project ? projectSnapshot(context.projectId, project) : null;
}

async function persistAsset(context: UploadContext, asset:
  | { kind: "poster" | "share"; url: string; storagePath: string }
  | { kind: "trailer"; url: string; videoId: string }
  | { kind: "pitch-deck"; storagePath: string; name: string }) {
  if (context.type === "draft") {
    return saveFilmmakerDraftAsset({ visitorId: context.visitorId, draftId: context.draftId, asset });
  }
  return saveFilmmakerProjectAsset({
    provider: context.identity.provider,
    uid: context.identity.uid,
    projectId: context.projectId,
    asset,
  });
}

async function cleanupReplaced(context: UploadContext, config: BunnyConfig, path: string | null): Promise<void> {
  if (path && storagePathIsSafe(path, context)) {
    try {
      await deleteStoredObject(config, path, context);
    } catch {
      console.warn("Bunny Storage could not remove a replaced project media object; the saved replacement remains authoritative.");
    }
  }
}

function uploadedImageUrl(config: BunnyConfig, path: string): string {
  return cdnUrl(config, path);
}

function safeDispositionName(name: string): string {
  return name.replace(/[\r\n"\\;]/g, "_").replace(/[^\x20-\x7e]/g, "_").slice(0, 160) || "pitch-deck.pdf";
}

async function readDeckFromStorage(
  req: Request,
  res: ExpressResponse,
  config: BunnyConfig,
  path: string,
  filename: string | null,
  owner?: UploadContext,
): Promise<void> {
  res.set("Cache-Control", "private, no-store, max-age=0");
  res.set("X-Content-Type-Options", "nosniff");
  if (!storagePathIsSafe(path, owner)) {
    res.status(404).json({ error: "Pitch deck not found." });
    return;
  }
  let response: Response;
  try {
    response = await providerRequest(storageUrl(config, path), {
      headers: { AccessKey: config.storageKey, Accept: "application/pdf" },
    }, 60_000);
  } catch {
    res.status(502).json({ error: "Bunny Storage could not serve this deck." });
    return;
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    res.status(response.status === 404 ? 404 : 502).json({ error: response.status === 404 ? "Pitch deck file is missing from storage." : "Bunny Storage could not serve this deck." });
    return;
  }
  let bytes: Buffer;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  try {
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_DECK_BYTES) {
      await response.body.cancel();
      throw new Error("Stored PDF exceeds its upload limit.");
    }
    reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_DECK_BYTES) {
        await reader.cancel();
        throw new Error("Stored PDF exceeds its upload limit.");
      }
      chunks.push(Buffer.from(next.value));
    }
    bytes = Buffer.concat(chunks, total);
  } catch {
    await reader?.cancel().catch(() => undefined);
    res.status(502).json({ error: "Pitch deck could not be safely fetched from Bunny Storage." });
    return;
  }
  if (bytes.length < 5 || bytes.toString("ascii", 0, 5) !== "%PDF-") {
    res.status(502).json({ error: "Stored pitch deck is not a valid PDF." });
    return;
  }
  const safeName = safeDispositionName(filename ?? "pitch-deck.pdf");
  res.status(200)
    .type("application/pdf")
    .set("Content-Disposition", `inline; filename="${safeName}"`)
    .set("Content-Length", String(bytes.length))
    .send(bytes);
}

export async function serveFilmmakerPitchDeck(
  req: Request,
  res: ExpressResponse,
  path: string,
  filename: string | null,
  owner?: UploadContext,
): Promise<void> {
  const config = readConfig().storage;
  if (!config) {
    res.status(503).type("text/plain").send("Pitch deck storage is temporarily unavailable.");
    return;
  }
  await readDeckFromStorage(req, res, config, path, filename, owner);
}

export async function checkFilmmakerPitchDeckStatus(
  path: string | null,
): Promise<"available" | "missing" | "unavailable"> {
  if (!path) return "missing";
  const config = readConfig().storage;
  if (!config || !storagePathIsSafe(path)) return "unavailable";
  try {
    const response = await providerRequest(storageUrl(config, path), {
      headers: { AccessKey: config.storageKey, Range: "bytes=0-4" },
    });
    if (response.status === 404) {
      await response.body?.cancel().catch(() => undefined);
      return "missing";
    }
    if ((response.status !== 200 && response.status !== 206) || !response.body) {
      await response.body?.cancel().catch(() => undefined);
      return "unavailable";
    }
    const reader = response.body.getReader();
    let signature = Buffer.alloc(0);
    try {
      while (signature.length < 5) {
        const chunk = await reader.read();
        if (chunk.done) break;
        signature = Buffer.concat([signature, Buffer.from(chunk.value).subarray(0, 5 - signature.length)]);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    return signature.toString("ascii", 0, 5) === "%PDF-" ? "available" : "unavailable";
  } catch {
    return "unavailable";
  }
}

export async function cleanupDiscardedDraftMaterials(input: {
  visitorId: string;
  paths: string[];
  videoId: string | null;
}): Promise<void> {
  if (!UUID.test(input.visitorId)) return;
  const owner: UploadContext = {
    type: "draft",
    visitorId: input.visitorId,
    draftId: 1,
    ownerKey: `draft:${input.visitorId}:cleanup`,
  };
  const config = readConfig();
  if (config.storage) {
    for (const path of input.paths) {
      if (!storagePathIsSafe(path, owner)) continue;
      await deleteCreatedObject(config.storage, path, owner);
    }
  }
  if (input.videoId && config.stream && UUID.test(input.videoId)) {
    await deleteCreatedVideo(config.stream, input.videoId);
  }
}

async function assertRawBody(
  req: Request,
  res: ExpressResponse,
  expectedSize: number,
  acceptedTypes: readonly string[],
): Promise<Buffer | null> {
  const type = contentType(req);
  if (!acceptedTypes.includes(type)) {
    res.status(400).json({ error: `Unsupported upload content type. Accepted types: ${acceptedTypes.join(", ")}.` });
    return null;
  }
  const bytes = Buffer.isBuffer(req.body) ? req.body : null;
  if (!bytes || bytes.length !== expectedSize) {
    res.status(400).json({ error: "Upload bytes do not match the declared Content-Length." });
    return null;
  }
  return bytes;
}

function rawBody(limit: number, label: string) {
  const parse = express.raw({ type: () => true, limit });
  return (req: Request, res: ExpressResponse, next: NextFunction): void => {
    parse(req, res, (error?: unknown) => {
      if (!error) {
        next();
        return;
      }
      const candidate = error as { status?: number; type?: string };
      if (candidate.type === "entity.too.large" || candidate.status === 413) {
        res.status(413).json({ error: `${label} exceeds its size limit.` });
        return;
      }
      res.status(400).json({ error: "Upload body could not be read." });
    });
  };
}

router.get("/filmmakers/draft-materials", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const visitor = visitorId(req);
  if (!visitor) {
    res.status(400).json({ error: "A recorded visitor cookie is required." });
    return;
  }
  const draftId = numericHeader(req, "X-MSI-Draft-Id");
  if (draftId === null) {
    res.status(409).json({ error: "X-MSI-Draft-Id is missing or invalid." });
    return;
  }
  const access = await authorizeFilmmakerVisitor(req, res, visitor);
  if (!access.allowed) return;
  const progress = await findVisitorFlowProgress(visitor, "filmmaker");
  if (!progress || progress.completed) {
    res.status(404).json({ error: "No active filmmaker draft was found." });
    return;
  }
  if (!requireMatchingFilmmakerContext(req, res, "X-MSI-Draft-Id", progress.id, "draft")) return;
  const materials = await getFilmmakerDraftMaterials(visitor, draftId);
  if (!materials) {
    res.status(404).json({ error: "No active filmmaker draft was found." });
    return;
  }
  res.json(GetFilmmakerDraftMaterialsResponse.parse(draftSnapshot(draftId, materials)));
});

router.patch("/filmmakers/draft-materials", async (req, res): Promise<void> => {
  const visitor = visitorId(req);
  if (!visitor) {
    res.status(400).json({ error: "A recorded visitor cookie is required." });
    return;
  }
  const draftId = numericHeader(req, "X-MSI-Draft-Id");
  if (draftId === null) {
    res.status(409).json({ error: "X-MSI-Draft-Id is missing or invalid." });
    return;
  }
  const access = await authorizeFilmmakerVisitor(req, res, visitor);
  if (!access.allowed) return;
  const progress = await findVisitorFlowProgress(visitor, "filmmaker");
  if (!progress || progress.completed) {
    res.status(404).json({ error: "No active filmmaker draft was found." });
    return;
  }
  if (!requireMatchingFilmmakerContext(req, res, "X-MSI-Draft-Id", progress.id, "draft")) return;
  const parsed = UpdateFilmmakerDraftMaterialsBody.safeParse(req.body);
  if (!parsed.success || Object.keys(req.body ?? {}).some((key) => !["synopsis", "trailer_url"].includes(key))
    || !Object.keys(req.body ?? {}).length) {
    res.status(400).json({ error: "Provide a synopsis or trailer URL to update." });
    return;
  }
  if (parsed.data.trailer_url !== undefined && !validTrailerLink(parsed.data.trailer_url ?? null)) {
    res.status(400).json({ error: "Trailer URL must be a valid HTTP or HTTPS URL." });
    return;
  }
  const result = await updateFilmmakerDraftText({
    visitorId: visitor,
    draftId,
    ...(parsed.data.synopsis !== undefined ? { synopsis: parsed.data.synopsis ?? null } : {}),
    ...(parsed.data.trailer_url !== undefined ? { trailerUrl: parsed.data.trailer_url ?? null } : {}),
  });
  if (!result) {
    res.status(404).json({ error: "No active filmmaker draft with a selected project was found." });
    return;
  }
  if (result.previousVideoId && UUID.test(result.previousVideoId)) {
    const config = readConfig().stream;
    if (config) await deleteCreatedVideo(config, result.previousVideoId);
  }
  res.set("Cache-Control", "private, no-store");
  res.json(UpdateFilmmakerDraftMaterialsResponse.parse(draftSnapshot(draftId, result.materials)));
});

router.get("/filmmakers/draft-materials/pitch-deck", async (req, res): Promise<void> => {
  const visitor = visitorId(req);
  const draftId = numericHeader(req, "X-MSI-Draft-Id") ?? numericQuery(req, "draft_id");
  if (!visitor || draftId === null) {
    res.status(400).json({ error: "A recorded visitor cookie and draft identifier are required." });
    return;
  }
  const access = await authorizeFilmmakerVisitor(req, res, visitor);
  if (!access.allowed) return;
  const progress = await findVisitorFlowProgress(visitor, "filmmaker");
  if (!progress || progress.completed) {
    res.status(404).json({ error: "No active filmmaker draft was found." });
    return;
  }
  const suppliedHeaderId = numericHeader(req, "X-MSI-Draft-Id");
  if ((suppliedHeaderId !== null && suppliedHeaderId !== draftId)
    || (suppliedHeaderId === null && progress.id !== draftId)) {
    res.status(409).json({ error: "The draft identifier does not match the current draft." });
    return;
  }
  const materials = await getFilmmakerDraftMaterials(visitor, draftId);
  if (!materials?.pitchDeckStoragePath) {
    res.status(404).json({ error: "Pitch deck not found." });
    return;
  }
  const config = readConfig().storage;
  if (!config) {
    res.status(503).json({ error: "Bunny Storage is not configured." });
    return;
  }
  const owner: UploadContext = { type: "draft", visitorId: visitor, draftId, ownerKey: `draft:${visitor}:${draftId}` };
  await readDeckFromStorage(req, res, config, materials.pitchDeckStoragePath, materials.pitchDeckName, owner);
});

router.post("/filmmakers/draft-materials/images", reserveUpload, rawBody(MAX_IMAGE_BYTES, "Image"),
  async (req, res): Promise<void> => {
    const context = contextFor(req);
    if (!context) return;
    const query = UploadFilmmakerDraftImageQueryParams.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: "Image kind must be poster or share." });
      return;
    }
    let expected: number;
    try {
      expected = fileContentLength(req, MAX_IMAGE_BYTES, "Image");
    } catch (error) {
      const routeError = error instanceof RouteError ? error : null;
      res.status(routeError?.statusCode ?? 400).json({ error: routeError?.message ?? "Invalid image size." });
      return;
    }
    const input = await assertRawBody(req, res, expected, IMAGE_TYPES);
    if (!input) return;
    const declaredType = contentType(req);
    let output: Buffer;
    let outputType: string;
    try {
      const image = sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "error" });
      const metadata = await image.metadata();
      if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_IMAGE_PIXELS
        || imageFormat(metadata.format) !== declaredType) {
        res.status(400).json({ error: "Image bytes do not match the declared type or exceed the pixel limit." });
        return;
      }
      const converted = declaredType === "image/jpeg"
        ? await image.rotate().jpeg({ quality: 88, mozjpeg: true }).toBuffer({ resolveWithObject: true })
        : declaredType === "image/png"
          ? await image.rotate().png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer({ resolveWithObject: true })
          : await image.rotate().webp({ quality: 88 }).toBuffer({ resolveWithObject: true });
      if (!converted.data.length || converted.data.length > MAX_IMAGE_BYTES) {
        res.status(413).json({ error: "Processed image exceeds the 10 MB limit." });
        return;
      }
      output = converted.data;
      outputType = imageFormat(converted.info.format) ?? "image/jpeg";
    } catch {
      res.status(400).json({ error: "Image could not be decoded and safely re-encoded." });
      return;
    }

    const extension = outputType === "image/jpeg" ? "jpg" : outputType.split("/")[1]!;
    const path = publicStoragePath(context, `${randomUUID()}.${extension}`);
    const config = readConfig().storage;
    if (!config) {
      res.status(503).json({ error: "Bunny Storage is not configured." });
      return;
    }
    let uploaded: Response;
    try {
      uploaded = await providerRequest(storageUrl(config, path), {
        method: "PUT",
        headers: { AccessKey: config.storageKey, "Content-Type": "application/octet-stream" },
        body: output,
      }, 60_000);
    } catch {
      res.status(502).json({ error: "Bunny Storage is temporarily unavailable." });
      return;
    }
    await uploaded.body?.cancel().catch(() => undefined);
    if (!uploaded.ok) {
      req.log.warn({ statusCode: uploaded.status }, "Bunny Storage draft image upload failed");
      res.status(502).json({ error: "Bunny Storage could not save this image." });
      return;
    }

    let committed = false;
    try {
      const persisted = await persistAsset(context, {
        kind: query.data.kind,
        url: uploadedImageUrl(config, path),
        storagePath: path,
      });
      if (!persisted) {
        await deleteCreatedObject(config, path, context);
        res.status(404).json({ error: "Draft or project is no longer available." });
        return;
      }
      committed = true;
      if (context.type === "draft") {
        const snapshot = await currentDraftSnapshot(context);
        if (!snapshot) {
          res.status(404).json({ error: "Draft is no longer available." });
          return;
        }
        res.set("Cache-Control", "private, no-store");
        res.json(UploadFilmmakerDraftImageResponse.parse(snapshot));
      } else {
        const snapshot = await currentProjectSnapshot(context);
        if (!snapshot) {
          res.status(404).json({ error: "Project is no longer available." });
          return;
        }
        res.set("Cache-Control", "private, no-store");
        res.json(UploadFilmmakerProjectImageResponse.parse(snapshot));
      }
      await cleanupReplaced(context, config, persisted.previousPath);
    } catch (error) {
      if (!committed) await deleteCreatedObject(config, path, context);
      throw error;
    }
  });

async function uploadDeck(req: Request, res: ExpressResponse, context: UploadContext, expectedSize: number): Promise<void> {
  if (contentType(req) !== "application/pdf") {
    res.status(400).json({ error: "Pitch decks must be uploaded as application/pdf." });
    return;
  }
  const bytes = Buffer.isBuffer(req.body) ? req.body : null;
  if (!bytes || bytes.length !== expectedSize) {
    res.status(400).json({ error: "Upload bytes do not match the declared Content-Length." });
    return;
  }
  if (bytes.length < 5 || bytes.toString("ascii", 0, 5) !== "%PDF-") {
    res.status(400).json({ error: "The uploaded file does not contain a valid PDF signature." });
    return;
  }
  const name = safeFilename(req.get("X-MSI-Filename"), "pdf");
  if (!name) {
    res.status(400).json({ error: "Pitch deck filename is invalid." });
    return;
  }
  const config = readConfig().storage;
  if (!config) {
    res.status(503).json({ error: "Bunny Storage is not configured." });
    return;
  }
  const path = publicStoragePath(context, `${randomUUID()}.pdf`);
  let uploaded: Response;
  try {
    uploaded = await providerRequest(storageUrl(config, path), {
      method: "PUT",
      headers: { AccessKey: config.storageKey, "Content-Type": "application/pdf" },
      body: bytes,
    }, 60_000);
  } catch {
    res.status(502).json({ error: "Bunny Storage is temporarily unavailable." });
    return;
  }
  await uploaded.body?.cancel().catch(() => undefined);
  if (!uploaded.ok) {
    req.log.warn({ statusCode: uploaded.status }, "Bunny Storage pitch deck upload failed");
    res.status(502).json({ error: "Bunny Storage could not save this pitch deck." });
    return;
  }
  let committed = false;
  try {
    const persisted = await persistAsset(context, { kind: "pitch-deck", storagePath: path, name });
    if (!persisted) {
      await deleteCreatedObject(config, path, context);
      res.status(404).json({ error: "Draft or project is no longer available." });
      return;
    }
    committed = true;
    const snapshot = context.type === "draft"
      ? await currentDraftSnapshot(context)
      : await currentProjectSnapshot(context);
    if (!snapshot) {
      res.status(404).json({ error: "Draft or project is no longer available." });
      return;
    }
    await cleanupReplaced(context, config, persisted.previousPath);
    res.set("Cache-Control", "private, no-store");
    if (context.type === "draft") res.json(UploadFilmmakerDraftPitchDeckResponse.parse(snapshot));
    else res.json(UploadFilmmakerProjectPitchDeckResponse.parse(snapshot));
  } catch (error) {
    if (!committed) await deleteCreatedObject(config, path, context);
    throw error;
  }
}

router.post("/filmmakers/draft-materials/pitch-deck", reserveUpload, rawBody(MAX_DECK_BYTES, "Pitch deck"),
  async (req, res): Promise<void> => {
    const context = contextFor(req);
    if (!context) return;
    let expectedSize: number;
    try {
      expectedSize = fileContentLength(req, MAX_DECK_BYTES, "Pitch deck");
    } catch (error) {
      const routeError = error instanceof RouteError ? error : null;
      res.status(routeError?.statusCode ?? 400).json({ error: routeError?.message ?? "Invalid deck size." });
      return;
    }
    await uploadDeck(req, res, context, expectedSize);
  });

router.post("/filmmakers/project-materials/pitch-deck", reserveUpload, rawBody(MAX_DECK_BYTES, "Pitch deck"),
  async (req, res): Promise<void> => {
    const context = contextFor(req);
    if (!context) return;
    let expectedSize: number;
    try {
      expectedSize = fileContentLength(req, MAX_DECK_BYTES, "Pitch deck");
    } catch (error) {
      const routeError = error instanceof RouteError ? error : null;
      res.status(routeError?.statusCode ?? 400).json({ error: routeError?.message ?? "Invalid deck size." });
      return;
    }
    await uploadDeck(req, res, context, expectedSize);
  });

async function createStreamVideo(config: BunnyConfig, title: string): Promise<string> {
  const response = await providerRequest(
    `https://video.bunnycdn.com/library/${encodeURIComponent(config.libraryId)}/videos`,
    {
      method: "POST",
      headers: { AccessKey: config.streamKey, "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({ title, collectionId: config.collectionId }),
    },
  );
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new RouteError(502, "Bunny Stream could not create the trailer upload.");
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!payload || typeof payload !== "object" || !("guid" in payload)
    || typeof payload.guid !== "string" || !UUID.test(payload.guid)) {
    throw new RouteError(502, "Bunny Stream returned an invalid trailer identifier.");
  }
  return payload.guid;
}

async function uploadStreamVideo(
  req: Request,
  res: ExpressResponse,
  config: BunnyConfig,
  videoId: string,
  expectedSize: number,
  type: string,
): Promise<void> {
  const controller = new AbortController();
  let bodyError: RouteError | null = null;
  let clientDisconnected = false;
  let receivedBytes = 0;
  let signature = Buffer.alloc(0);
  const guard = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      receivedBytes += chunk.length;
      if (receivedBytes > MAX_TRAILER_BYTES || receivedBytes > expectedSize) {
        bodyError = new RouteError(receivedBytes > MAX_TRAILER_BYTES ? 413 : 400,
          receivedBytes > MAX_TRAILER_BYTES ? "Trailer exceeds the 500 MB limit." : "Upload body exceeds the declared Content-Length.");
        callback(bodyError);
        return;
      }
      if (signature.length < 12) {
        signature = Buffer.concat([signature, chunk.subarray(0, 12 - signature.length)]);
      }
      if (signature.length >= (type === "video/webm" ? 4 : 12) && !isTrailerBytes(signature, type)) {
        bodyError = new RouteError(400, "Trailer bytes do not match the declared MP4, WebM, or MOV type.");
        callback(bodyError);
        return;
      }
      callback(null, chunk);
    },
    flush(callback) {
      if (receivedBytes !== expectedSize) {
        bodyError = new RouteError(400, "Upload body does not match the declared Content-Length.");
        callback(bodyError);
        return;
      }
      if (!isTrailerBytes(signature, type)) {
        bodyError = new RouteError(400, "Trailer bytes do not match the declared MP4, WebM, or MOV type.");
        callback(bodyError);
        return;
      }
      callback();
    },
  });
  const disconnect = () => {
    clientDisconnected = true;
    controller.abort();
    req.unpipe(guard);
  };
  const requestError = () => disconnect();
  const requestClosed = () => {
    if (!req.complete) disconnect();
  };
  const responseClosed = () => {
    if (!res.writableEnded) disconnect();
  };
  req.once("aborted", disconnect);
  req.once("error", requestError);
  req.once("close", requestClosed);
  res.once("close", responseClosed);
  guard.once("error", () => {
    controller.abort();
    req.unpipe(guard);
  });
  const body = Readable.toWeb(guard) as ReadableStream<Uint8Array>;
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30 * 60 * 1000)]);
  try {
    const uploadPromise = fetch(
      `https://video.bunnycdn.com/library/${encodeURIComponent(config.libraryId)}/videos/${encodeURIComponent(videoId)}`,
      {
        method: "PUT",
        headers: {
          AccessKey: config.streamKey,
          "Content-Type": type,
          "Content-Length": String(expectedSize),
        },
        body,
        duplex: "half",
        signal,
      } as RequestInit & { duplex: "half" },
    );
    req.pipe(guard);
    const response = await uploadPromise;
    await response.body?.cancel().catch(() => undefined);
    if (!response.ok) throw new RouteError(502, "Bunny Stream could not store this trailer.");
    await finished(guard);
    if (clientDisconnected || controller.signal.aborted) throw new RouteError(400, "Trailer upload was aborted.");

    const verified = await providerRequest(
      `https://video.bunnycdn.com/library/${encodeURIComponent(config.libraryId)}/videos/${encodeURIComponent(videoId)}`,
      { headers: { AccessKey: config.streamKey, accept: "application/json" } },
    );
    if (!verified.ok) {
      await verified.body?.cancel().catch(() => undefined);
      throw new RouteError(502, "Bunny Stream could not verify this trailer.");
    }
    const remote: unknown = await verified.json().catch(() => null);
    if (!remote || typeof remote !== "object" || !("status" in remote)
      || typeof remote.status !== "number" || !ACCEPTED_VIDEO_STATUSES.has(remote.status)) {
      throw new RouteError(502, "Bunny Stream returned an unverifiable trailer status.");
    }
  } catch (error) {
    controller.abort();
    req.unpipe(guard);
    guard.destroy();
    if (clientDisconnected) throw new RouteError(400, "Trailer upload was aborted.");
    if (bodyError) throw bodyError;
    throw error;
  } finally {
    req.off("aborted", disconnect);
    req.off("error", requestError);
    req.off("close", requestClosed);
    res.off("close", responseClosed);
  }
}

async function uploadTrailer(req: Request, res: ExpressResponse, context: UploadContext, expectedSize: number): Promise<void> {
  const type = contentType(req);
  if (!TRAILER_TYPES.includes(type as typeof TRAILER_TYPES[number])) {
    res.status(400).json({ error: "Upload content type must be MP4, WebM, or MOV." });
    return;
  }
  const filename = safeFilename(req.get("X-MSI-Filename"));
  if (!filename) {
    res.status(400).json({ error: "Trailer filename is invalid." });
    return;
  }
  const config = readConfig().stream;
  if (!config) {
    res.status(503).json({ error: "Bunny Stream is not configured." });
    return;
  }
  let videoId: string | null = null;
  let committed = false;
  try {
    videoId = await createStreamVideo(config, filename);
    await uploadStreamVideo(req, res, config, videoId, expectedSize, type);
    const url = `https://iframe.mediadelivery.net/embed/${encodeURIComponent(config.libraryId)}/${encodeURIComponent(videoId)}`;
    const result = await persistAsset(context, { kind: "trailer", url, videoId });
    if (!result) throw new RouteError(404, "Draft or project is no longer available.");
    committed = true;
    const snapshot = context.type === "draft"
      ? await currentDraftSnapshot(context)
      : await currentProjectSnapshot(context);
    if (!snapshot) throw new RouteError(404, "Draft or project is no longer available.");
    if (context.type === "draft" && result.previousVideoId && result.previousVideoId !== videoId) {
      await deleteCreatedVideo(config, result.previousVideoId);
    }
    res.set("Cache-Control", "private, no-store");
    if (context.type === "draft") res.json(UploadFilmmakerDraftTrailerResponse.parse(snapshot));
    else res.json(UploadFilmmakerProjectTrailerResponse.parse(snapshot));
  } catch (error) {
    if (videoId && !committed) await deleteCreatedVideo(config, videoId);
    if (res.destroyed || res.writableEnded || !res.writable) return;
    const routeError = error instanceof RouteError ? error : null;
    if (routeError) {
      res.status(routeError.statusCode).json({ error: routeError.message });
      return;
    }
    req.log.warn({ error: error instanceof Error ? error.message : "Bunny Stream error" }, "Bunny Stream trailer upload failed");
    res.status(502).json({ error: "Bunny Stream is temporarily unavailable." });
  }
}

router.post("/filmmakers/draft-materials/trailer", reserveUpload, async (req, res): Promise<void> => {
  const context = contextFor(req);
  if (!context) return;
  let expectedSize: number;
  try {
    expectedSize = fileContentLength(req, MAX_TRAILER_BYTES, "Trailer");
  } catch (error) {
    const routeError = error instanceof RouteError ? error : null;
    res.status(routeError?.statusCode ?? 400).json({ error: routeError?.message ?? "Invalid trailer size." });
    return;
  }
  await uploadTrailer(req, res, context, expectedSize);
});

router.post("/filmmakers/project-materials/trailer", reserveUpload, async (req, res): Promise<void> => {
  const context = contextFor(req);
  if (!context) return;
  let expectedSize: number;
  try {
    expectedSize = fileContentLength(req, MAX_TRAILER_BYTES, "Trailer");
  } catch (error) {
    const routeError = error instanceof RouteError ? error : null;
    res.status(routeError?.statusCode ?? 400).json({ error: routeError?.message ?? "Invalid trailer size." });
    return;
  }
  await uploadTrailer(req, res, context, expectedSize);
});

router.get("/filmmakers/project-materials", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const identity = await authenticateFilmmaker(req, res, true);
  if (!identity) return;
  const projectId = numericHeader(req, "X-MSI-Project-Id");
  if (projectId === null) {
    res.status(400).json({ error: "X-MSI-Project-Id is required." });
    return;
  }
  const project = await getFilmmakerProjectMaterials(identity.provider, identity.uid, projectId);
  if (!project) {
    res.status(403).json({ error: "This project is not available to the signed-in filmmaker account." });
    return;
  }
  res.json(GetFilmmakerProjectMaterialsResponse.parse(projectSnapshot(projectId, project)));
});

router.patch("/filmmakers/project-materials", async (req, res): Promise<void> => {
  const identity = await authenticateFilmmaker(req, res, true);
  if (!identity) return;
  const projectId = numericHeader(req, "X-MSI-Project-Id");
  if (projectId === null) {
    res.status(400).json({ error: "X-MSI-Project-Id is required." });
    return;
  }
  const parsed = UpdateFilmmakerProjectMaterialsBody.safeParse(req.body);
  if (!parsed.success || Object.keys(req.body ?? {}).some((key) => !["synopsis", "trailer_url"].includes(key))
    || !Object.keys(req.body ?? {}).length) {
    res.status(400).json({ error: "Provide a synopsis or trailer URL to update." });
    return;
  }
  if (parsed.data.trailer_url !== undefined && !validTrailerLink(parsed.data.trailer_url ?? null)) {
    res.status(400).json({ error: "Trailer URL must be a valid HTTP or HTTPS URL." });
    return;
  }
  const result = await updateFilmmakerProjectTextMaterials({
    provider: identity.provider,
    uid: identity.uid,
    projectId,
    ...(parsed.data.synopsis !== undefined ? { synopsis: parsed.data.synopsis ?? null } : {}),
    ...(parsed.data.trailer_url !== undefined ? { trailerUrl: parsed.data.trailer_url ?? null } : {}),
  });
  if (!result) {
    res.status(403).json({ error: "This project is not available to the signed-in filmmaker account." });
    return;
  }
  const project = await getFilmmakerProjectMaterials(identity.provider, identity.uid, projectId);
  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  res.set("Cache-Control", "private, no-store");
  res.json(UpdateFilmmakerProjectMaterialsResponse.parse(projectSnapshot(projectId, project)));
});

async function ownerProjectContext(req: Request, res: ExpressResponse, identity: FilmmakerIdentity, projectId: number): Promise<UploadContext | null> {
  const project = await getFilmmakerProjectMaterials(identity.provider, identity.uid, projectId);
  if (!project) {
    res.status(403).json({ error: "This project is not available to the signed-in filmmaker account." });
    return null;
  }
  return {
    type: "project",
    identity,
    projectId,
    visitorId: project.visitorId,
    ownerKey: `${identity.provider}:${identity.uid}:project:${projectId}`,
  };
}

router.get("/filmmakers/project-materials/pitch-deck", async (req, res): Promise<void> => {
  const identity = await authenticateFilmmaker(req, res, true);
  if (!identity) return;
  const projectId = numericQuery(req, "project_id");
  if (projectId === null) {
    res.status(400).json({ error: "A valid project_id is required." });
    return;
  }
  let project = await getFilmmakerProjectMaterials(identity.provider, identity.uid, projectId);
  let adminAccess = false;
  if (req.query.original === "1") {
    const admin = await authorizeAdminIdentity(req, res);
    if (!admin) return;
    const pitch = await getAdminFilmmakerPitch(projectId);
    if (!pitch) { res.status(404).json({ error: "Project not found." }); return; }
    const original = pitch.project.submissionSnapshot?.project as Record<string, unknown> | undefined;
    if (typeof original?.pitchDeckStoragePath !== "string") {
      res.status(404).json({ error: "No original pitch deck evidence was preserved." }); return;
    }
    const config = readConfig().storage;
    if (!config) { res.status(503).json({ error: "Bunny Storage is not configured." }); return; }
    res.set("Cache-Control", "private, no-store");
    await readDeckFromStorage(req, res, config, original.pitchDeckStoragePath,
      typeof original.pitchDeckName === "string" ? original.pitchDeckName : null, undefined);
    return;
  }
  if (!project) {
    const admin = await authorizeAdminIdentity(req, res);
    if (!admin) return;
    const pitch = await getAdminFilmmakerPitch(projectId);
    if (!pitch) {
      res.status(404).json({ error: "Project not found." });
      return;
    }
    adminAccess = true;
    project = { ...pitch.project, visitorId: pitch.filmmaker?.visitorId ?? null };
  }
  if (!project?.pitchDeckStoragePath) {
    res.status(404).json({ error: "Pitch deck not found." });
    return;
  }
  const config = readConfig().storage;
  if (!config) {
    res.status(503).json({ error: "Bunny Storage is not configured." });
    return;
  }
  const owner = adminAccess ? undefined : await ownerProjectContext(req, res, identity, projectId) ?? undefined;
  await readDeckFromStorage(req, res, config, project.pitchDeckStoragePath, project.pitchDeckName, owner);
});

router.post("/filmmakers/project-materials/images", reserveUpload, rawBody(MAX_IMAGE_BYTES, "Image"),
  async (req, res): Promise<void> => {
    const context = contextFor(req);
    if (!context || context.type !== "project") return;
    const query = UploadFilmmakerProjectImageQueryParams.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: "Image kind must be poster or share." });
      return;
    }
    let expected: number;
    try {
      expected = fileContentLength(req, MAX_IMAGE_BYTES, "Image");
    } catch (error) {
      const routeError = error instanceof RouteError ? error : null;
      res.status(routeError?.statusCode ?? 400).json({ error: routeError?.message ?? "Invalid image size." });
      return;
    }
    const input = await assertRawBody(req, res, expected, IMAGE_TYPES);
    if (!input) return;
    const declaredType = contentType(req);
    let output: Buffer;
    let outputType: string;
    try {
      const image = sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "error" });
      const metadata = await image.metadata();
      if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_IMAGE_PIXELS
        || imageFormat(metadata.format) !== declaredType) {
        res.status(400).json({ error: "Image bytes do not match the declared type or exceed the pixel limit." });
        return;
      }
      const converted = declaredType === "image/jpeg"
        ? await image.rotate().jpeg({ quality: 88, mozjpeg: true }).toBuffer({ resolveWithObject: true })
        : declaredType === "image/png"
          ? await image.rotate().png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer({ resolveWithObject: true })
          : await image.rotate().webp({ quality: 88 }).toBuffer({ resolveWithObject: true });
      if (!converted.data.length || converted.data.length > MAX_IMAGE_BYTES) {
        res.status(413).json({ error: "Processed image exceeds the 10 MB limit." });
        return;
      }
      output = converted.data;
      outputType = imageFormat(converted.info.format) ?? "image/jpeg";
    } catch {
      res.status(400).json({ error: "Image could not be decoded and safely re-encoded." });
      return;
    }
    const extension = outputType === "image/jpeg" ? "jpg" : outputType.split("/")[1]!;
    const path = publicStoragePath(context, `${randomUUID()}.${extension}`);
    const config = readConfig().storage;
    if (!config) {
      res.status(503).json({ error: "Bunny Storage is not configured." });
      return;
    }
    let uploaded: Response;
    try {
      uploaded = await providerRequest(storageUrl(config, path), {
        method: "PUT",
        headers: { AccessKey: config.storageKey, "Content-Type": "application/octet-stream" },
        body: output,
      }, 60_000);
    } catch {
      res.status(502).json({ error: "Bunny Storage is temporarily unavailable." });
      return;
    }
    await uploaded.body?.cancel().catch(() => undefined);
    if (!uploaded.ok) {
      req.log.warn({ statusCode: uploaded.status }, "Bunny Storage project image upload failed");
      res.status(502).json({ error: "Bunny Storage could not save this image." });
      return;
    }
    try {
      const persisted = await persistAsset(context, { kind: query.data.kind, url: cdnUrl(config, path), storagePath: path });
      if (!persisted) {
        await deleteCreatedObject(config, path, context);
        res.status(404).json({ error: "Project is no longer available." });
        return;
      }
      const snapshot = await currentProjectSnapshot(context);
      if (!snapshot) {
        await deleteCreatedObject(config, path, context);
        res.status(404).json({ error: "Project is no longer available." });
        return;
      }
      res.set("Cache-Control", "private, no-store");
      res.json(UploadFilmmakerProjectImageResponse.parse(snapshot));
      await cleanupReplaced(context, config, persisted.previousPath);
    } catch (error) {
      await deleteCreatedObject(config, path, context);
      throw error;
    }
  });

router.delete("/filmmakers/draft-materials/:kind", async (req, res): Promise<void> => {
  const kind = DeleteFilmmakerDraftMaterialParams.safeParse(req.params);
  if (!kind.success) {
    res.status(400).json({ error: "Unknown draft material." });
    return;
  }
  const visitor = visitorId(req);
  const draftId = numericHeader(req, "X-MSI-Draft-Id");
  if (!visitor || draftId === null) {
    res.status(400).json({ error: "A recorded visitor cookie and X-MSI-Draft-Id are required." });
    return;
  }
  const access = await authorizeFilmmakerVisitor(req, res, visitor);
  if (!access.allowed) return;
  const progress = await findVisitorFlowProgress(visitor, "filmmaker");
  if (!progress || progress.completed || !requireMatchingFilmmakerContext(req, res, "X-MSI-Draft-Id", progress.id, "draft")) return;
  const removed = await removeFilmmakerDraftAsset({ visitorId: visitor, draftId, kind: kind.data.kind });
  if (!removed) {
    res.status(404).json({ error: "No active filmmaker draft was found." });
    return;
  }
  const config = readConfig();
  const owner: UploadContext = { type: "draft", visitorId: visitor, draftId, ownerKey: `draft:${visitor}:${draftId}` };
  if (removed.removedPath && config.storage && storagePathIsSafe(removed.removedPath, owner)) {
    await deleteStoredObject(config.storage, removed.removedPath, owner).catch((error) => {
      req.log.warn({ error: error instanceof Error ? error.message : "Bunny Storage error" }, "Removed draft material remains in storage");
    });
  }
  if (removed.removedVideoId && config.stream) await deleteCreatedVideo(config.stream, removed.removedVideoId);
  res.set("Cache-Control", "private, no-store");
  res.json(DeleteFilmmakerDraftMaterialResponse.parse(draftSnapshot(draftId, removed.materials)));
});

router.delete("/filmmakers/project-materials/:kind", async (req, res): Promise<void> => {
  const kind = DeleteFilmmakerProjectMaterialParams.safeParse(req.params);
  if (!kind.success) {
    res.status(400).json({ error: "Unknown project material." });
    return;
  }
  const identity = await authenticateFilmmaker(req, res, true);
  if (!identity) return;
  const projectId = numericHeader(req, "X-MSI-Project-Id");
  if (projectId === null) {
    res.status(400).json({ error: "X-MSI-Project-Id is required." });
    return;
  }
  const before = await getFilmmakerProjectMaterials(identity.provider, identity.uid, projectId);
  const removed = await removeFilmmakerProjectAsset({
    provider: identity.provider,
    uid: identity.uid,
    projectId,
    kind: kind.data.kind,
  });
  if (!removed) {
    res.status(403).json({ error: "This project is not available to the signed-in filmmaker account." });
    return;
  }
  const context: UploadContext = {
    type: "project",
    identity,
    projectId,
    visitorId: before?.visitorId ?? null,
    ownerKey: `${identity.provider}:${identity.uid}:project:${projectId}`,
  };
  const config = readConfig();
  if (removed.removedPath && config.storage && storagePathIsSafe(removed.removedPath, context)) {
    await deleteStoredObject(config.storage, removed.removedPath, context).catch((error) => {
      req.log.warn({ projectId, error: error instanceof Error ? error.message : "Bunny Storage error" }, "Removed project material remains in storage");
    });
  }
  const project = await getFilmmakerProjectMaterials(identity.provider, identity.uid, projectId);
  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  res.set("Cache-Control", "private, no-store");
  res.json(DeleteFilmmakerProjectMaterialResponse.parse(projectSnapshot(projectId, project)));
});

router.post("/filmmakers/project-materials/:kind", (_req, res): void => {
  res.status(400).json({ error: "Use the documented images, trailer, or pitch-deck upload route." });
});

export default router;