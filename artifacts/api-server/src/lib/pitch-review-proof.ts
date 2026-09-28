import { createHmac, timingSafeEqual } from "node:crypto";

const LIFETIME_SECONDS = 24 * 60 * 60;
const PURPOSE = "movie-show-investing:review-checkout:v1";

function signature(projectId: number, issuedAt: number): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required for pitch review checkout");
  return createHmac("sha256", secret).update(`${PURPOSE}:${projectId}:${issuedAt}`).digest();
}

export function issuePitchReviewProof(projectId: number): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  return `${projectId}.${issuedAt}.${signature(projectId, issuedAt).toString("base64url")}`;
}

export function verifyPitchReviewProof(value: string | undefined, projectId: number): boolean {
  if (!value || value.length > 160) return false;
  const match = /^([1-9]\d*)\.(\d{10})\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!match || Number(match[1]) !== projectId) return false;
  const issuedAt = Number(match[2]);
  const now = Math.floor(Date.now() / 1000);
  if (issuedAt > now || now - issuedAt > LIFETIME_SECONDS) return false;
  const actual = Buffer.from(match[3], "base64url");
  const expected = signature(projectId, issuedAt);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}