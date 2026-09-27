import type { Request, Response } from "express";
import { getFilmmakerAccountVisitorUid } from "@workspace/db";
import { FirebaseConfigurationError, verifyFirebaseIdToken } from "./firebase-admin";

export type FilmmakerIdentity = {
  uid: string;
  email: string;
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
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);
  if (!match) {
    if (authorization && required) {
      res.status(401).json({ error: "A valid Firebase bearer token is required." });
      return null;
    }
    if (required) {
      res.status(401).json({ error: "A Firebase ID token is required." });
    }
    return null;
  }

  try {
    const decoded = await verifyFirebaseIdToken(match[1]);
    if (decoded.email_verified !== true || typeof decoded.email !== "string" || !decoded.uid) {
      if (required) {
        res.status(403).json({ error: "A verified Firebase email is required." });
      }
      return null;
    }
    return { uid: decoded.uid, email: decoded.email.trim().toLowerCase() };
  } catch (error) {
    if (error instanceof FirebaseConfigurationError) {
      if (required) {
        res.status(503).json({ error: error.message });
      }
      return null;
    }
    req.log.warn({ error: errorMessage(error) }, "Firebase filmmaker token verification failed");
    if (required) {
      res.status(401).json({ error: "The Firebase ID token is invalid or expired." });
    }
    return null;
  }
}

export type FilmmakerVisitorAccess =
  | { allowed: true; identity: FilmmakerIdentity | null }
  | { allowed: false };

export async function authorizeFilmmakerVisitor(
  req: Request,
  res: Response,
  visitorId: string,
): Promise<FilmmakerVisitorAccess> {
  const ownerUid = await getFilmmakerAccountVisitorUid(visitorId);
  if (!ownerUid) return { allowed: true, identity: null };

  const identity = await authenticateFilmmaker(req, res, true);
  if (!identity) return { allowed: false };
  if (identity.uid !== ownerUid) {
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