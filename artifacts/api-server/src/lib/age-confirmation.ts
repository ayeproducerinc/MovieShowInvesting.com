import { pool } from "@workspace/db";
import type { Response } from "express";
import type { FilmmakerIdentity } from "./filmmaker-auth";

export async function getAccountAgeConfirmation(identity: FilmmakerIdentity) {
  const { rows } = await pool.query<{ confirmed_at: Date }>(
    "select confirmed_at from age_confirmations where provider = $1 and uid = $2",
    [identity.provider, identity.uid],
  );
  return { age_confirmed: !!rows[0], confirmed_at: rows[0]?.confirmed_at.toISOString() ?? null };
}

export async function requireAccountAgeConfirmation(identity: FilmmakerIdentity, res: Response): Promise<boolean> {
  if ((await getAccountAgeConfirmation(identity)).age_confirmed) return true;
  res.status(403).json({
    error: "Confirm that you are 18 years of age or older before submitting, signing, or starting paid review. Your saved work is unchanged.",
    code: "age_confirmation_required",
  });
  return false;
}