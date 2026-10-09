import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Project update emails are on by default for confirmed backers and can be
 * turned off (DECISIONS.md › Project updates, rule d as revised 2026-10-09).
 * Preferences are append-only events; the latest one wins.
 */
const PURPOSE = "update-emails-off";

function signature(investorId: number, secret: string): Buffer {
  return createHmac("sha256", secret).update(`${PURPOSE}:${investorId}`).digest();
}

/** One-click opt-out token for an email link. It can only turn update emails off. */
export function optOutToken(investorId: number, secret: string): string {
  return signature(investorId, secret).toString("base64url");
}

export function verifyOptOutToken(investorId: number, token: string, secret: string): boolean {
  if (!Number.isSafeInteger(investorId) || investorId < 1 || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const expected = signature(investorId, secret);
  const given = Buffer.from(token, "base64url");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Link placed in every update email; null when the app URL or secret is missing. */
export function optOutUrl(appUrl: string | undefined, investorId: number, secret: string | undefined): string | null {
  const configured = appUrl?.trim();
  if (!configured || !secret) return null;
  try {
    const url = new URL(configured);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    return `${url.origin}/api/update-emails/off?i=${investorId}&t=${optOutToken(investorId, secret)}`;
  } catch {
    return null;
  }
}

/** Latest preference for one investor; no record means on. */
export const LATEST_PREFERENCE_SQL = `
  select allowed from project_update_email_events
  where investor_id = $1 order by recorded_at desc, id desc limit 1`;
