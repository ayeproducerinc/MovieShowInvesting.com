import type { Request, Response } from "express";
import { pool } from "@workspace/db";
import { resolveProtectedIdentity, type FilmmakerIdentity } from "./filmmaker-auth";
import { ISSUER_URL } from "./replit-auth";

function normalizedEmail(value: string): string {
  return value.trim().toLowerCase();
}

export async function authorizeAdminIdentity(
  req: Request,
  res: Response,
): Promise<FilmmakerIdentity | null> {
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!adminEmail) {
    res.status(503).json({ error: "Admin access is not configured. Set ADMIN_EMAIL on the server." });
    return null;
  }

  const identity = await resolveProtectedIdentity(req, res);
  if (!identity) return null;
  if (identity.email !== adminEmail) {
    res.status(403).json({ error: "This account is not an administrator." });
    return null;
  }

  if (identity.provider === "replit") {
    const adminReplitSubject = process.env.ADMIN_REPLIT_SUB?.trim();
    if (!adminReplitSubject) {
      res.status(503).json({ error: "Replit admin access is not configured. Set ADMIN_REPLIT_SUB on the server." });
      return null;
    }

    const result = await pool.query<{ issuer: string; subject: string; email: string }>(
      `select issuer, subject, email
       from replit_auth_users
       where id::text = $1
       limit 1`,
      [identity.uid],
    );
    const replitUser = result.rows[0];
    if (
      !replitUser ||
      replitUser.issuer !== ISSUER_URL ||
      replitUser.subject !== adminReplitSubject ||
      normalizedEmail(replitUser.email) !== adminEmail
    ) {
      res.status(403).json({ error: "This account is not an administrator." });
      return null;
    }
  }

  return identity;
}