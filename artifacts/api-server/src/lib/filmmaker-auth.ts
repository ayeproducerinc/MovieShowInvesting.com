import type { Request, Response } from "express";
import { getFilmmakerAccountVisitorOwner } from "@workspace/db";
import { FirebaseConfigurationError, verifyFirebaseIdToken } from "./firebase-admin";

export type FilmmakerIdentity = {
  uid: string;
  // Sign-in is Firebase only. "replit" remains in the type solely so guards on
  // legacy rows (replit_uid columns, kept in the schema) still type-check.
  provider: "firebase" | "replit";
  email: string;
  phoneNumber: string | null;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Authentication failed.";
}

export async function authenticateFilmmaker(
  req: Request,
  res: Response,
  required: boolean,
): Promise<FilmmakerIdentity | null> {
  const authorization = req.get("authorization");
  if (authorization !== undefined) {
    const match = authorization.match(/^Bearer\s+(\S+)$/i);
    if (!match) {
      res.status(401).json({ error: "A valid Firebase bearer token is required." });
      return null;
    }
    try {
      const decoded = await verifyFirebaseIdToken(match[1]);
      if (decoded.email_verified !== true || typeof decoded.email !== "string" || !decoded.uid) {
        res.status(403).json({ error: "A verified Firebase email is required." });
        return null;
      }
      return {
        uid: decoded.uid,
        provider: "firebase",
        email: decoded.email.trim().toLowerCase(),
        phoneNumber: typeof decoded.phone_number === "string" ? decoded.phone_number : null,
      };
    } catch (error) {
      if (error instanceof FirebaseConfigurationError) {
        res.status(503).json({ error: error.message });
        return null;
      }
      req.log.warn({ error: errorMessage(error) }, "Firebase filmmaker token verification failed");
      res.status(401).json({ error: "The Firebase ID token is invalid or expired." });
      return null;
    }
  }
  if (required) {
    res.status(401).json({ error: "A verified Google sign-in is required." });
  }
  return null;
}

export async function resolveProtectedIdentity(
  req: Request,
  res: Response,
  required = true,
): Promise<FilmmakerIdentity | null> {
  return authenticateFilmmaker(req, res, required);
}

export type FilmmakerVisitorAccess =
  | { allowed: true; identity: FilmmakerIdentity | null }
  | { allowed: false };

export async function authorizeFilmmakerVisitor(
  req: Request,
  res: Response,
  visitorId: string,
): Promise<FilmmakerVisitorAccess> {
  const identity = await authenticateFilmmaker(req, res, false);
  if (req.get("authorization") !== undefined && !identity) return { allowed: false };
  const owner = await getFilmmakerAccountVisitorOwner(visitorId);
  if (!owner) return { allowed: true, identity };

  if (!identity) {
    await authenticateFilmmaker(req, res, true);
    return { allowed: false };
  }
  if (identity.provider !== owner.provider || identity.uid !== owner.uid) {
    res.status(403).json({ error: "This visitor is linked to a different filmmaker account." });
    return { allowed: false };
  }
  return { allowed: true, identity };
}

export function requireMatchingFilmmakerContext(
  req: Request,
  res: Response,
  headerName: "X-MSI-Project-Id" | "X-MSI-Draft-Id",
  expectedId: number,
  context: "project" | "draft",
): boolean {
  if (req.get(headerName) === String(expectedId)) return true;
  res.status(409).json({
    error: `${headerName} is missing or does not match the current ${context}. Refresh the page before retrying.`,
  });
  return false;
}