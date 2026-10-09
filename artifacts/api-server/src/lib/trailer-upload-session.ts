import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Pieced trailer uploads. The browser sends <= CHUNK_BYTES per request (under the
 * deployment proxy's request cap); the API forwards each piece to Bunny Stream's
 * TUS endpoint. The API creates the TUS upload with Upload-Length, so the
 * provider itself refuses bytes past the declared size (bounded-bunny-uploads).
 */
export const CHUNK_BYTES = 16 * 1024 * 1024;
export const SESSION_LIFETIME_SECONDS = 24 * 60 * 60;
const PURPOSE = "movie-show-investing:trailer-upload:v1";
const MAX_TOKEN_LENGTH = 4096;

export type TrailerUploadSession = {
  videoId: string;
  tusUrl: string;
  size: number;
  type: string;
  filename: string;
  ownerKey: string;
  /** Unix seconds; also the Bunny AuthorizationExpire value. */
  expire: number;
};

function key(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required for trailer uploads");
  return createHash("sha256").update(`${PURPOSE}:${secret}`).digest();
}

/** Authenticated encryption: the browser can neither read the TUS URL nor alter any field. */
export function sealTrailerSession(session: TrailerUploadSession): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(session), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

export function openTrailerSession(token: string | undefined, ownerKey: string, now = Date.now()): TrailerUploadSession | null {
  if (!token || token.length > MAX_TOKEN_LENGTH || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const raw = Buffer.from(token, "base64url");
  if (raw.length < 29) return null;
  let session: TrailerUploadSession;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const json = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
    session = JSON.parse(json) as TrailerUploadSession;
  } catch {
    return null;
  }
  if (session.ownerKey !== ownerKey || !Number.isSafeInteger(session.expire)
    || session.expire <= Math.floor(now / 1000)) return null;
  return session;
}

/** Bunny Stream TUS presigned signature: SHA256(library_id + api_key + expiration + video_id). */
export function bunnyTusSignature(libraryId: string, apiKey: string, expire: number, videoId: string): string {
  return createHash("sha256").update(`${libraryId}${apiKey}${expire}${videoId}`).digest("hex");
}

/** Returns an error message, or null when the piece fits the declared upload. */
export function validateChunk(session: Pick<TrailerUploadSession, "size">, offset: number, length: number): string | null {
  if (!Number.isSafeInteger(offset) || offset < 0) return "Upload offset is invalid.";
  if (!Number.isSafeInteger(length) || length < 1) return "Upload piece is empty.";
  if (length > CHUNK_BYTES) return "Upload piece exceeds the 16 MB limit.";
  if (offset + length > session.size) return "Upload piece extends past the declared trailer size.";
  return null;
}

/** TUS Upload-Metadata: comma-separated "key base64(value)" pairs. */
export function tusMetadata(fields: Record<string, string>): string {
  return Object.entries(fields)
    .filter(([, value]) => value)
    .map(([name, value]) => `${name} ${Buffer.from(value, "utf8").toString("base64")}`)
    .join(",");
}
