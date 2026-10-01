import { randomUUID } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { finished } from "node:stream/promises";
import cookieParser from "cookie-parser";
import express, { Router, type IRouter, type Request } from "express";
import sharp from "sharp";
import {
  clearOwnedPendingBunnyVideo,
  finalizeOwnedBunnyVideo,
  getOwnedFilmmakerMedia,
  removeOwnedFilmmakerImage,
  saveOwnedFilmmakerImage,
  setOwnedPendingBunnyVideo,
} from "@workspace/db";
import {
  DeleteFilmmakerImageHeader,
  DeleteFilmmakerImageQueryParams,
  GetFilmmakerMediaConfigResponse,
  UploadFilmmakerTrailerResponse,
  UploadFilmmakerImageQueryParams,
  UploadFilmmakerImageResponse,
} from "@workspace/api-zod";
import {
  authorizeFilmmakerVisitor,
  requireMatchingFilmmakerContext,
} from "../lib/filmmaker-auth";

const router: IRouter = Router();
router.use(cookieParser());

const VISITOR_COOKIE = "msi_visitor_id";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TRAILER_BYTES = 500 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_CONCURRENT_TRAILER_UPLOADS = 4;
const IMAGE_STORAGE_FOLDER = "Movie Show Investing folder";
const TRAILER_TYPES = ["video/mp4", "video/webm", "video/quicktime"] as const;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const ACCEPTED_VIDEO_STATUSES = new Set([1, 2, 3, 4, 7, 8]);
const STORAGE_HOSTS = new Set([
  "storage.bunnycdn.com",
  "ny.storage.bunnycdn.com",
  "la.storage.bunnycdn.com",
  "sg.storage.bunnycdn.com",
  "syd.storage.bunnycdn.com",
  "uk.storage.bunnycdn.com",
  "se.storage.bunnycdn.com",
  "br.storage.bunnycdn.com",
  "jh.storage.bunnycdn.com",
]);
const activeTrailerUploads = new Set<string>();
let reportedStorageConfigIssue = false;

type BunnyConfig = {
  streamKey: string;
  libraryId: string;
  collectionId: string;
  storageKey: string;
  storageZone: string;
  storageHost: string;
  cdnBaseUrl: string;
};

class UploadError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
  }
}

class BunnyError extends Error {}

function readConfig(): { stream: BunnyConfig | null; storage: BunnyConfig | null } {
  const streamKey = process.env.BUNNY_STREAM_API_KEY?.trim();
  const libraryId = process.env.BUNNY_STREAM_LIBRARY_ID?.trim();
  const collectionId = process.env.BUNNY_STREAM_COLLECTION_ID?.trim();
  const storageKey = process.env.BUNNY_STORAGE_API_KEY?.trim();
  const storageZone = process.env.BUNNY_STORAGE_ZONE?.trim();
  const rawStorageHost = process.env.BUNNY_STORAGE_HOST?.trim();
  const rawCdnBaseUrl = process.env.BUNNY_CDN_BASE_URL?.trim();

  let storageHost: string | null = null;
  if (rawStorageHost) {
    try {
      const parsed = new URL(rawStorageHost.includes("://") ? rawStorageHost : `https://${rawStorageHost}`);
      if (parsed.protocol === "https:" && !parsed.username && !parsed.password
        && parsed.pathname === "/" && !parsed.search && !parsed.hash
        && STORAGE_HOSTS.has(parsed.hostname.toLowerCase())) {
        storageHost = parsed.hostname.toLowerCase();
      }
    } catch {
      storageHost = null;
    }
  }

  let cdnBaseUrl: string | null = null;
  if (rawCdnBaseUrl) {
    try {
      const parsed = new URL(rawCdnBaseUrl);
      if (parsed.protocol === "https:" && parsed.hostname && !parsed.username && !parsed.password
        && !parsed.search && !parsed.hash) {
        cdnBaseUrl = parsed.toString().replace(/\/+$/, "");
      }
    } catch {
      cdnBaseUrl = null;
    }
  }

  const stream = streamKey && libraryId && collectionId && UUID.test(collectionId)
    ? { streamKey, libraryId, collectionId, storageKey: "", storageZone: "", storageHost: "", cdnBaseUrl: "" }
    : null;
  const storage = storageKey && storageZone && storageHost && cdnBaseUrl
    ? { streamKey: "", libraryId: "", collectionId: "", storageKey, storageZone, storageHost, cdnBaseUrl }
    : null;
  if (!storage && !reportedStorageConfigIssue
    && (storageKey || storageZone || rawStorageHost || rawCdnBaseUrl)) {
    const invalid = [
      !storageKey && "BUNNY_STORAGE_API_KEY",
      !storageZone && "BUNNY_STORAGE_ZONE",
      !storageHost && "BUNNY_STORAGE_HOST (must be a supported Bunny Storage hostname)",
      !cdnBaseUrl && "BUNNY_CDN_BASE_URL (must be an HTTPS URL)",
    ].filter(Boolean);
    console.warn(`Bunny Storage unavailable. Check ${invalid.join(", ")}. No secret values logged.`);
    reportedStorageConfigIssue = true;
  }
  return { stream, storage };
}

function visitorId(req: Request): string | null {
  const id = req.cookies?.[VISITOR_COOKIE];
  return typeof id === "string" && UUID.test(id) ? id : null;
}

function embedUrl(libraryId: string, videoId: string): string {
  return `https://iframe.mediadelivery.net/embed/${encodeURIComponent(libraryId)}/${encodeURIComponent(videoId)}`;
}

async function bunnyRequest(url: string, init: RequestInit, timeoutMs = 8000): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

async function deleteBunnyVideo(config: BunnyConfig, videoId: string): Promise<void> {
  try {
    await bunnyRequest(
      `https://video.bunnycdn.com/library/${encodeURIComponent(config.libraryId)}/videos/${encodeURIComponent(videoId)}`,
      { method: "DELETE", headers: { AccessKey: config.streamKey } },
    );
  } catch {
    // Best-effort cleanup; never expose provider credentials or response bodies.
  }
}

async function cleanupPendingVideo(config: BunnyConfig, visitor: string, videoId: string): Promise<void> {
  await deleteBunnyVideo(config, videoId);
  try {
    await clearOwnedPendingBunnyVideo({ visitorId: visitor, videoId });
  } catch {
    // Keep cleanup best-effort without masking the original upload failure.
  }
}

function isTrailerType(value: string | undefined): value is typeof TRAILER_TYPES[number] {
  return TRAILER_TYPES.includes(value as typeof TRAILER_TYPES[number]);
}

function isImageType(value: string | undefined): value is typeof IMAGE_TYPES[number] {
  return IMAGE_TYPES.includes(value as typeof IMAGE_TYPES[number]);
}

function imageTypeForSharp(format: string | undefined): typeof IMAGE_TYPES[number] | null {
  if (format === "jpeg") return "image/jpeg";
  if (format === "png") return "image/png";
  if (format === "webp") return "image/webp";
  return null;
}

function ownedFilmmakerImageStorageUrl(
  config: BunnyConfig,
  projectId: number,
  cdnUrl: string,
): string | null {
  try {
    const base = new URL(config.cdnBaseUrl);
    const image = new URL(cdnUrl);
    const ownedPrefix = `${base.pathname.replace(/\/+$/, "")}/${encodeURIComponent(IMAGE_STORAGE_FOLDER)}/filmmakers/${projectId}/`;
    if (image.protocol !== "https:" || image.origin !== base.origin
      || image.username || image.password || image.search || image.hash
      || !image.pathname.startsWith(ownedPrefix)) {
      return null;
    }

    const filename = image.pathname.slice(ownedPrefix.length);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp)$/i.test(filename)) {
      return null;
    }
    const path = `${IMAGE_STORAGE_FOLDER}/filmmakers/${projectId}/${filename}`;
    return `https://${config.storageHost}/${encodeURIComponent(config.storageZone)}/${path
      .split("/").map(encodeURIComponent).join("/")}`;
  } catch {
    return null;
  }
}

router.get("/filmmakers/media/config", (_req, res): void => {
  const config = readConfig();
  res.json(GetFilmmakerMediaConfigResponse.parse({
    stream_available: Boolean(config.stream),
    storage_available: Boolean(config.storage),
    trailer_max_bytes: MAX_TRAILER_BYTES,
    trailer_types: TRAILER_TYPES,
    image_max_bytes: MAX_IMAGE_BYTES,
    image_types: IMAGE_TYPES,
  }));
});

router.post("/filmmakers/media/trailer", async (req, res): Promise<void> => {
  const contentLengthHeader = req.get("content-length");
  if (contentLengthHeader === undefined) {
    res.status(411).json({ error: "Content-Length is required for trailer uploads." });
    return;
  }
  if (!/^[1-9][0-9]*$/.test(contentLengthHeader)) {
    res.status(400).json({ error: "Content-Length must be a positive integer." });
    return;
  }
  const contentLength = Number(contentLengthHeader);
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0) {
    res.status(400).json({ error: "Content-Length must be a positive integer." });
    return;
  }
  if (contentLength > MAX_TRAILER_BYTES) {
    res.status(413).json({ error: "Trailer exceeds the 500 MB limit." });
    return;
  }
  const contentType = req.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (!isTrailerType(contentType)) {
    res.status(400).json({ error: "Upload content type must be MP4, WebM, or MOV." });
    return;
  }
  const ownerId = visitorId(req);
  if (!ownerId) {
    res.status(400).json({ error: "A recorded visitor cookie is required." });
    return;
  }
  const access = await authorizeFilmmakerVisitor(req, res, ownerId);
  if (!access.allowed) return;
  const owner = await getOwnedFilmmakerMedia(ownerId);
  if (!owner) {
    res.status(404).json({ error: "No completed filmmaker project was found." });
    return;
  }
  if (access.identity
    && !requireMatchingFilmmakerContext(req, res, "X-MSI-Project-Id", owner.id, "project")) return;
  const config = readConfig().stream;
  if (!config) {
    res.status(503).json({ error: "Bunny Stream is not configured." });
    return;
  }
  if (activeTrailerUploads.has(ownerId) || activeTrailerUploads.size >= MAX_CONCURRENT_TRAILER_UPLOADS) {
    res.status(429).json({ error: "A trailer upload is already active or the server is at capacity." });
    return;
  }
  activeTrailerUploads.add(ownerId);

  const controller = new AbortController();
  let videoId: string | null = null;
  let pendingSaved = false;
  let finalized = false;
  let clientDisconnected = false;
  let bodyGuardError: UploadError | null = null;
  let requestStreamError: UploadError | null = null;
  let byteGuard: Transform | null = null;
  const stopRequestStream = (): void => {
    if (!byteGuard) return;
    req.unpipe(byteGuard);
    if (!byteGuard.destroyed) byteGuard.destroy();
  };
  const disconnect = (): void => {
    clientDisconnected = true;
    controller.abort();
    stopRequestStream();
  };
  const requestError = (): void => {
    requestStreamError = new UploadError(400, "Trailer request stream failed.");
    controller.abort();
    stopRequestStream();
  };
  const requestClosed = (): void => {
    // IncomingMessage emits close on normal completion too; complete distinguishes that from truncation.
    if (!req.complete) disconnect();
  };
  const responseClosed = (): void => {
    if (!res.writableEnded) disconnect();
  };
  req.once("aborted", disconnect);
  req.on("error", requestError);
  req.once("close", requestClosed);
  res.once("close", responseClosed);

  try {
    if (req.aborted) throw new UploadError(400, "Trailer upload was aborted.");
    const created = await bunnyRequest(
      `https://video.bunnycdn.com/library/${encodeURIComponent(config.libraryId)}/videos`,
      {
        method: "POST",
        headers: { AccessKey: config.streamKey, "Content-Type": "application/json", accept: "application/json" },
        body: JSON.stringify({ title: owner.title ?? "Film trailer", collectionId: config.collectionId }),
      },
    );
    const createdBody: unknown = await created.json().catch(() => null);
    if (!created.ok || createdBody === null || typeof createdBody !== "object"
      || !("guid" in createdBody) || typeof createdBody.guid !== "string" || !UUID.test(createdBody.guid)) {
      req.log.warn({ statusCode: created.status }, "Bunny Stream video creation failed");
      throw new BunnyError("Bunny Stream could not create the trailer upload.");
    }
    videoId = createdBody.guid;
    if (controller.signal.aborted) throw new UploadError(400, "Trailer upload was aborted.");

    pendingSaved = await setOwnedPendingBunnyVideo({ visitorId: ownerId, videoId });
    if (!pendingSaved) throw new UploadError(404, "No completed filmmaker project was found.");
    if (owner.pendingBunnyVideoId && owner.pendingBunnyVideoId !== videoId) {
      await deleteBunnyVideo(config, owner.pendingBunnyVideoId);
    }

    let receivedBytes = 0;
    byteGuard = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        receivedBytes += chunk.length;
        if (receivedBytes > MAX_TRAILER_BYTES) {
          callback(new UploadError(413, "Trailer exceeds the 500 MB limit."));
          return;
        }
        if (receivedBytes > contentLength) {
          callback(new UploadError(400, "Upload body exceeds the declared Content-Length."));
          return;
        }
        callback(null, chunk);
      },
      flush(callback) {
        if (receivedBytes !== contentLength) {
          callback(new UploadError(400, "Upload body does not match Content-Length."));
          return;
        }
        callback();
      },
    });
    byteGuard.once("error", (error: Error) => {
      if (error instanceof UploadError) bodyGuardError = error;
      controller.abort();
      req.unpipe(byteGuard!);
    });

    const body = Readable.toWeb(byteGuard) as ReadableStream<Uint8Array>;
    const uploadSignal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(30 * 60 * 1000),
    ]);
    const uploadPromise = fetch(
      `https://video.bunnycdn.com/library/${encodeURIComponent(config.libraryId)}/videos/${encodeURIComponent(videoId)}`,
      {
        method: "PUT",
        headers: {
          AccessKey: config.streamKey,
          "Content-Type": contentType,
          "Content-Length": String(contentLength),
        },
        body,
        duplex: "half",
        signal: uploadSignal,
      } as RequestInit & { duplex: "half" },
    );
    req.pipe(byteGuard);

    const uploaded = await uploadPromise;
    if (!uploaded.ok) {
      req.log.warn({ statusCode: uploaded.status }, "Bunny Stream trailer upload failed");
      controller.abort();
      await uploaded.body?.cancel().catch(() => undefined);
      throw new BunnyError("Bunny Stream could not store this trailer.");
    }
    await finished(byteGuard);
    await uploaded.body?.cancel().catch(() => undefined);
    if (controller.signal.aborted || clientDisconnected) {
      throw new UploadError(400, "Trailer upload was aborted.");
    }

    const verified = await bunnyRequest(
      `https://video.bunnycdn.com/library/${encodeURIComponent(config.libraryId)}/videos/${encodeURIComponent(videoId)}`,
      { headers: { AccessKey: config.streamKey, accept: "application/json" } },
    );
    if (!verified.ok) {
      req.log.warn({ statusCode: verified.status }, "Bunny Stream trailer verification failed");
      throw new BunnyError("Bunny Stream could not verify this trailer.");
    }
    const remote: unknown = await verified.json().catch(() => null);
    if (remote === null || typeof remote !== "object" || !("status" in remote)
      || typeof remote.status !== "number" || !ACCEPTED_VIDEO_STATUSES.has(remote.status)) {
      throw new BunnyError("Bunny Stream returned an unverifiable upload status.");
    }
    // Bunny storageSize is the asynchronously encoded output size, not the uploaded byte count.
    // The byteGuard above enforces the original-file limit before forwarding bytes to Bunny.

    const trailerUrl = embedUrl(config.libraryId, videoId);
    const response = UploadFilmmakerTrailerResponse.parse({
      video_id: videoId,
      trailer_url: trailerUrl,
      embed_url: trailerUrl,
      thumbnail_url: null,
    });
    finalized = await finalizeOwnedBunnyVideo({
      visitorId: ownerId,
      videoId,
      trailerUrl,
    });
    if (!finalized) throw new UploadError(404, "No matching pending trailer was found for this project.");
    res.status(201).json(response);
  } catch (error) {
    if (!finalized) controller.abort();
    if (videoId && !finalized) await cleanupPendingVideo(config, ownerId, videoId);
    if (clientDisconnected || req.aborted || res.destroyed || res.writableEnded || !res.writable) return;
    const uploadError = bodyGuardError ?? requestStreamError ?? (error instanceof UploadError ? error : null);
    if (uploadError) {
      res.status(uploadError.statusCode).json({ error: uploadError.message });
      return;
    }
    if (error instanceof BunnyError || (error instanceof Error && error.name === "AbortError")) {
      res.status(502).json({ error: error.message || "Bunny Stream is temporarily unavailable." });
      return;
    }
    throw error;
  } finally {
    activeTrailerUploads.delete(ownerId);
    req.off("aborted", disconnect);
    req.off("error", requestError);
    req.off("close", requestClosed);
    res.off("close", responseClosed);
  }
});

router.post(
  "/filmmakers/media/image",
  express.raw({ type: () => true, limit: MAX_IMAGE_BYTES }),
  async (req, res): Promise<void> => {
    const query = UploadFilmmakerImageQueryParams.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: "Image kind must be poster or share." });
      return;
    }
    const ownerId = visitorId(req);
    if (!ownerId) {
      res.status(400).json({ error: "A recorded visitor cookie is required." });
      return;
    }
    const access = await authorizeFilmmakerVisitor(req, res, ownerId);
    if (!access.allowed) return;
    const owner = await getOwnedFilmmakerMedia(ownerId);
    if (!owner) {
      res.status(404).json({ error: "No completed filmmaker project was found." });
      return;
    }
    if (access.identity
      && !requireMatchingFilmmakerContext(req, res, "X-MSI-Project-Id", owner.id, "project")) return;
    const config = readConfig().storage;
    if (!config) {
      res.status(503).json({ error: "Bunny Storage is not configured." });
      return;
    }
    const contentType = req.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    const input = Buffer.isBuffer(req.body) ? req.body : null;
    if (!input || input.length === 0 || input.length > MAX_IMAGE_BYTES || !isImageType(contentType)) {
      res.status(400).json({ error: "Upload a JPEG, PNG, or WebP image no larger than 10 MB." });
      return;
    }

    let encoded: Buffer;
    let outputType: typeof IMAGE_TYPES[number];
    try {
      const image = sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "error" });
      const metadata = await image.metadata();
      const decodedType = imageTypeForSharp(metadata.format);
      if (!decodedType || decodedType !== contentType || !metadata.width || !metadata.height
        || metadata.width * metadata.height > MAX_IMAGE_PIXELS) {
        res.status(400).json({ error: "Image bytes do not match the declared type or exceed the pixel limit." });
        return;
      }

      const converted = contentType === "image/jpeg"
        ? await image.rotate().jpeg({ quality: 88, mozjpeg: true }).toBuffer({ resolveWithObject: true })
        : contentType === "image/png"
          ? await image.rotate().png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer({ resolveWithObject: true })
          : await image.rotate().webp({ quality: 88 }).toBuffer({ resolveWithObject: true });
      if (converted.data.length === 0 || converted.data.length > MAX_IMAGE_BYTES) {
        res.status(400).json({ error: "Processed image exceeds the 10 MB limit." });
        return;
      }
      encoded = converted.data;
      outputType = imageTypeForSharp(converted.info.format) ?? "image/jpeg";
    } catch {
      res.status(400).json({ error: "Image could not be decoded and safely re-encoded." });
      return;
    }

    const extension = outputType === "image/jpeg" ? "jpg" : outputType.split("/")[1];
    const objectName = `${randomUUID()}.${extension}`;
    const path = `${IMAGE_STORAGE_FOLDER}/filmmakers/${owner.id}/${objectName}`;
    const storageUrl = `https://${config.storageHost}/${encodeURIComponent(config.storageZone)}/${path
      .split("/").map(encodeURIComponent).join("/")}`;
    const cdnUrl = `${config.cdnBaseUrl}/${path.split("/").map(encodeURIComponent).join("/")}`;
    try {
      const uploaded = await fetch(storageUrl, {
        method: "PUT",
        headers: { AccessKey: config.storageKey, "Content-Type": "application/octet-stream" },
        body: encoded,
        signal: AbortSignal.timeout(30000),
      });
      if (!uploaded.ok) {
        req.log.warn({ statusCode: uploaded.status }, "Bunny Storage image upload failed");
        res.status(502).json({ error: "Bunny Storage could not save this image." });
        return;
      }
    } catch {
      res.status(502).json({ error: "Bunny Storage is temporarily unavailable." });
      return;
    }

    let saved: boolean;
    try {
      saved = await saveOwnedFilmmakerImage({
        visitorId: ownerId,
        kind: query.data.kind,
        url: cdnUrl,
        storagePath: path,
      });
    } catch (error) {
      try {
        await bunnyRequest(storageUrl, { method: "DELETE", headers: { AccessKey: config.storageKey } });
      } catch {
        // Best-effort cleanup after a persistence error.
      }
      throw error;
    }
    if (!saved) {
      try {
        await bunnyRequest(storageUrl, { method: "DELETE", headers: { AccessKey: config.storageKey } });
      } catch {
        // Best-effort cleanup for a project that was removed during upload.
      }
      res.status(404).json({ error: "No completed filmmaker project was found." });
      return;
    }
    res.json(UploadFilmmakerImageResponse.parse({ kind: query.data.kind, image_url: cdnUrl }));
  },
);

router.delete("/filmmakers/media/image", async (req, res): Promise<void> => {
  const query = DeleteFilmmakerImageQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Image kind must be poster or share." });
    return;
  }
  const ownerId = visitorId(req);
  if (!ownerId) {
    res.status(400).json({ error: "A recorded visitor cookie is required." });
    return;
  }
  const access = await authorizeFilmmakerVisitor(req, res, ownerId);
  if (!access.allowed) return;
  const owner = await getOwnedFilmmakerMedia(ownerId);
  if (!owner) {
    res.status(404).json({ error: "No completed filmmaker project was found." });
    return;
  }
  if (access.identity
    && !requireMatchingFilmmakerContext(req, res, "X-MSI-Project-Id", owner.id, "project")) return;

  const parsedHeader = DeleteFilmmakerImageHeader.safeParse({
    "X-MSI-Expected-Image-Url": req.get("X-MSI-Expected-Image-Url"),
  });
  if (!parsedHeader.success) {
    res.status(409).json({ error: "The expected image URL is missing or invalid. Refresh the project before retrying." });
    return;
  }
  const expectedUrl = parsedHeader.data["X-MSI-Expected-Image-Url"];
  const currentUrl = query.data.kind === "poster" ? owner.posterUrl : owner.shareImageUrl;
  if (!currentUrl || currentUrl !== expectedUrl) {
    res.status(409).json({ error: "This image changed since it was shown. Refresh the project before retrying." });
    return;
  }

  const config = readConfig().storage;
  if (!config) {
    res.status(503).json({ error: "Bunny Storage is not configured, so this image cannot be safely removed." });
    return;
  }
  const storageUrl = ownedFilmmakerImageStorageUrl(config, owner.id, currentUrl);
  let result: Awaited<ReturnType<typeof removeOwnedFilmmakerImage>>;
  try {
    result = await removeOwnedFilmmakerImage({
      visitorId: ownerId,
      projectId: owner.id,
      kind: query.data.kind,
      expectedUrl,
      removeStoredObject: async () => {
        if (!storageUrl) return;
        let deleted: Response;
        try {
          deleted = await bunnyRequest(storageUrl, {
            method: "DELETE",
            headers: { AccessKey: config.storageKey },
          });
        } catch {
          req.log.warn({ projectId: owner.id, kind: query.data.kind }, "Bunny Storage image deletion request failed");
          throw new BunnyError("Bunny Storage is temporarily unavailable.");
        }
        if (!deleted.ok && deleted.status !== 404) {
          req.log.warn({ statusCode: deleted.status, projectId: owner.id, kind: query.data.kind }, "Bunny Storage image deletion failed");
          throw new BunnyError("Bunny Storage could not remove this image.");
        }
      },
    });
  } catch (error) {
    if (error instanceof BunnyError) {
      res.status(502).json({ error: `${error.message} The image remains attached to the project.` });
      return;
    }
    throw error;
  }
  if (result === "not_found") {
    res.status(404).json({ error: "No completed filmmaker project was found." });
    return;
  }
  if (result === "changed") {
    res.status(409).json({ error: "This image changed during removal. Refresh the project before retrying." });
    return;
  }
  if (!storageUrl) {
    req.log.warn({ projectId: owner.id, kind: query.data.kind }, "Skipping deletion for an image outside the project's owned Bunny Storage path");
  }
  res.sendStatus(204);
});

export default router;