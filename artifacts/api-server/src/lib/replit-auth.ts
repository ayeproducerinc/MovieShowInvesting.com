import { randomBytes } from "node:crypto";
import { pool, type AuthSessionUser } from "@workspace/db";
import type { Request, Response } from "express";
import * as oidc from "openid-client";

export const ISSUER_URL = process.env.ISSUER_URL ?? "https://replit.com/oidc";
export const SESSION_COOKIE = "__Host-msi.sid";
export const OIDC_COOKIE_PREFIX = "__Host-msi.oidc.";
export const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
export const OIDC_TTL = 10 * 60 * 1000;

export interface ReplitSessionData {
  user: AuthSessionUser;
}

let oidcConfig: oidc.Configuration | null = null;

function getClientId(): string {
  if (!process.env.REPL_ID) {
    throw new Error("REPL_ID is required to configure OIDC.");
  }
  return process.env.REPL_ID;
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

export async function getOidcConfig(): Promise<oidc.Configuration> {
  if (!oidcConfig) {
    const issuer = new URL(ISSUER_URL);
    if (issuer.protocol !== "https:") {
      throw new Error("OIDC issuer must use HTTPS.");
    }
    oidcConfig = await oidc.discovery(issuer, getClientId());
  }
  return oidcConfig;
}

export { getClientId };

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

export async function createSession(user: AuthSessionUser): Promise<string> {
  const sid = randomBytes(32).toString("hex");
  await pool.query(
    "insert into sessions (sid, sess, expire) values ($1, $2::jsonb, $3)",
    [sid, JSON.stringify({ user }), new Date(Date.now() + SESSION_TTL)],
  );
  return sid;
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

export async function upsertVerifiedOidcUser(claims: oidc.IDToken): Promise<AuthSessionUser> {
  const claimValues = claims as oidc.IDToken & Record<string, unknown>;
  if (
    typeof claimValues.iss !== "string" ||
    claimValues.iss !== ISSUER_URL ||
    typeof claimValues.sub !== "string" ||
    !claimValues.sub ||
    claimValues.email_verified !== true ||
    typeof claimValues.email !== "string"
  ) {
    throw new Error("OIDC identity requires a verified email address.");
  }

  const email = claimValues.email.trim().toLowerCase();
  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new Error("OIDC identity contains an invalid email address.");
  }
  const optionalString = (value: unknown): string | null =>
    typeof value === "string" && value.trim() ? value.trim() : null;
  const rawImage = optionalString(claimValues.profile_image_url ?? claimValues.picture);
  let profileImageUrl: string | null = null;
  if (rawImage) {
    try {
      const parsedImage = new URL(rawImage);
      if (parsedImage.protocol === "https:") profileImageUrl = parsedImage.href;
    } catch {
      profileImageUrl = null;
    }
  }

  const firstName = optionalString(claimValues.first_name ?? claimValues.given_name);
  const lastName = optionalString(claimValues.last_name ?? claimValues.family_name);
  const result = await pool.query<{
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    profile_image_url: string | null;
  }>(
    `insert into replit_auth_users
      (issuer, subject, email, first_name, last_name, profile_image_url)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (issuer, subject) do update set
       email = excluded.email,
       first_name = excluded.first_name,
       last_name = excluded.last_name,
       profile_image_url = excluded.profile_image_url,
       updated_at = now()
     returning id, email, first_name, last_name, profile_image_url`,
    [claimValues.iss, claimValues.sub, email, firstName, lastName, profileImageUrl],
  );
  const user = result.rows[0];
  if (!user) {
    throw new Error("OIDC account could not be persisted.");
  }

  return {
    id: user.id,
    email: user.email,
    firstName: user.first_name,
    lastName: user.last_name,
    profileImageUrl: user.profile_image_url,
  };
}