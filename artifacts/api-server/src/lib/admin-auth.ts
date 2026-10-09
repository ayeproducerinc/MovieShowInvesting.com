import type { Request, Response } from "express";
import { resolveProtectedIdentity, type FilmmakerIdentity } from "./filmmaker-auth";
import { getFirebaseUidForEmail } from "./firebase-admin";

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

  // Admin access is Google (Firebase) only: the email must also map to the
  // canonical Firebase account for ADMIN_EMAIL.
  if (identity.provider !== "firebase") {
    res.status(403).json({ error: "This account is not an administrator." });
    return null;
  }
  let canonicalUid: string;
  try {
    canonicalUid = await getFirebaseUidForEmail(adminEmail);
  } catch {
    req.log.error("Firebase admin identity lookup unavailable");
    res.status(503).json({ error: "Admin access could not be verified right now." });
    return null;
  }
  if (identity.uid !== canonicalUid) {
    res.status(403).json({ error: "This account is not an administrator." });
    return null;
  }

  return identity;
}