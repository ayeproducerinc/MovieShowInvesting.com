import { pool, type AuthSessionUser } from "@workspace/db";
import type { Request, Response } from "express";

export const ISSUER_URL = process.env.ISSUER_URL ?? "https://replit.com/oidc";
export const SESSION_COOKIE = "__Host-msi.sid";
export const OIDC_COOKIE_PREFIX = "__Host-msi.oidc.";
export const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
export const OIDC_TTL = 10 * 60 * 1000;

export interface ReplitSessionData {
  user: AuthSessionUser;
}

function trustedHosts(): Set<string> {
  return new Set(
    [process.env.REPLIT_DOMAINS, process.env.REPLIT_DEV_DOMAIN]
      .filter((value): value is string => Boolean(value))
      .flatMap((value) => value.split(","))
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function getTrustedOrigin(req: Request): string {
  const incomingHost = (req.get("x-forwarded-host") ?? req.get("host") ?? "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  if (!incomingHost || incomingHost.includes("@")) {
    throw new Error("Request host is not trusted for authentication.");
  }

  let parsedHost: URL;
  try {
    parsedHost = new URL(`https://${incomingHost}`);
  } catch {
    throw new Error("Request host is not trusted for authentication.");
  }
  if (parsedHost.username || parsedHost.password || parsedHost.pathname !== "/") {
    throw new Error("Request host is not trusted for authentication.");
  }

  const configuredOrigin = process.env.AUTH_PUBLIC_ORIGIN;
  if (configuredOrigin) {
    let publicUrl: URL;
    try {
      publicUrl = new URL(configuredOrigin);
    } catch {
      throw new Error("AUTH_PUBLIC_ORIGIN must be a valid origin.");
    }
    if (
      publicUrl.protocol !== "https:" ||
      publicUrl.username ||
      publicUrl.password ||
      publicUrl.pathname !== "/" ||
      publicUrl.search ||
      publicUrl.hash ||
      publicUrl.host.toLowerCase() !== incomingHost
    ) {
      throw new Error("Request host does not match AUTH_PUBLIC_ORIGIN.");
    }
    return publicUrl.origin;
  }

  const domains = trustedHosts();
  const allowed =
    domains.has(parsedHost.hostname.toLowerCase()) &&
    (!parsedHost.port || parsedHost.port === "443");
  const localDevelopment =
    process.env.NODE_ENV !== "production" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(parsedHost.hostname) &&
    (!parsedHost.port || /^\d{1,5}$/.test(parsedHost.port));
  if (!allowed && !localDevelopment) {
    throw new Error("Request host is not trusted for authentication.");
  }

  return `${localDevelopment && req.get("x-forwarded-proto") === "http" ? "http" : "https"}://${parsedHost.host}`;
}

export function getSafeReturnTo(value: unknown, origin: string): string {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return "/";
  }

  try {
    const target = new URL(value, origin);
    return target.origin === origin ? `${target.pathname}${target.search}${target.hash}` : "/";
  } catch {
    return "/";
  }
}

export function setSecureCookie(res: Response, name: string, value: string, maxAge: number): void {
  res.cookie(name, value, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
    maxAge,
  });
}

export function clearSecureCookie(res: Response, name: string): void {
  res.clearCookie(name, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
  });
}

export async function getSession(sid: string): Promise<ReplitSessionData | null> {
  const result = await pool.query<{ sess: unknown; expire: Date }>(
    "select sess, expire from sessions where sid = $1 limit 1",
    [sid],
  );
  const row = result.rows[0];
  if (!row || row.expire <= new Date()) {
    if (row) await deleteSession(sid);
    return null;
  }
  if (
    !row.sess ||
    typeof row.sess !== "object" ||
    !("user" in row.sess) ||
    !row.sess.user ||
    typeof row.sess.user !== "object"
  ) {
    await deleteSession(sid);
    return null;
  }
  return row.sess as ReplitSessionData;
}

export async function deleteSession(sid: string): Promise<void> {
  await pool.query("delete from sessions where sid = $1", [sid]);
}
