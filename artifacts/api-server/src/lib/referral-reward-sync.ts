import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

/** Freeze the first verified paid project in the same transaction as payment. */
export function referralRewardSyncSql(referrerId?: string) {
  return sql`INSERT INTO referral_rewards(referred_id,referrer_id,project_id,project_title,session_id,payment_checked_at)
    SELECT m.id,m.referred_by,first_payment.project_id,first_payment.title,first_payment.session_id,first_payment.paid_at
    FROM referral_members m
    JOIN LATERAL (
      SELECT c.project_id,p.title,c.session_id,c.paid_at
      FROM filmmakers f JOIN projects p ON p.filmmaker_id=f.id
      JOIN pitch_review_checkouts c ON c.project_id=p.id
      WHERE ((m.provider='firebase' AND f.firebase_uid=m.uid AND f.replit_uid IS NULL)
        OR (m.provider='replit' AND f.replit_uid=m.uid AND f.firebase_uid IS NULL))
        AND c.state='paid' AND c.paid_at IS NOT NULL AND c.paid_at>=m.attribution_at
        AND p.review_paid_at IS NOT NULL
      ORDER BY c.paid_at,c.created_at,c.session_id LIMIT 1
    ) first_payment ON true
    WHERE m.referred_by IS NOT NULL AND (${referrerId ?? null}::text IS NULL OR m.referred_by=${referrerId ?? null})
    ON CONFLICT DO NOTHING`;
}

export async function syncReferralRewards(referrerId?: string): Promise<void> {
  await db.execute(referralRewardSyncSql(referrerId));
}