import { createHash, randomBytes } from "node:crypto";
import { pool } from "@workspace/db";
import { PgDialect } from "drizzle-orm/pg-core";
import type { ReferralMember, ReferralReward, ReferralLedger } from "@workspace/api-zod";
import type { FilmmakerIdentity } from "./filmmaker-auth";
import { getFirebaseAccountCreatedAt } from "./firebase-admin";
import { verifyReferralReviewPayment } from "./pitch-review-payments";
import { canAttributeReferral, isPublicReferralProject, referralStatus, type ReferralPaymentStatus } from "./referral-policy";
import { syncReferralRewards, referralRewardSyncSql } from "./referral-reward-sync";
export { syncReferralRewards } from "./referral-reward-sync";

type Client = Awaited<ReturnType<typeof pool.connect>>;
export class ReferralError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
export const referralIdentityId = (identity: FilmmakerIdentity) => `${identity.provider}:${identity.uid}`;
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const validToken = (token: unknown): token is string => typeof token === "string" && /^[a-f0-9]{64}$/.test(token);
const iso = (date: Date | string | null) => date ? new Date(date).toISOString() : null;

export async function captureReferral(codeInput: string, existingToken: unknown, manual: boolean) {
  const code = codeInput.trim().toUpperCase();
  if (!/^[A-F0-9]{12}$/.test(code)) throw new ReferralError("That referral code is not valid.", 400);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (validToken(existingToken)) {
      const { rows: [receipt] } = await client.query(
        "SELECT * FROM referral_receipts WHERE token_hash=$1 AND expires_at>now() FOR UPDATE", [tokenHash(existingToken)]);
      if (receipt?.consumed_by) throw new ReferralError("This signup's referral is already finalized.");
      if (receipt && !manual) {
        await client.query("COMMIT");
        return { token: existingToken, expiresAt: iso(receipt.expires_at)! };
      }
    }
    const { rows: [member] } = await client.query("SELECT id FROM referral_members WHERE code=$1", [code]);
    if (!member) throw new ReferralError("That referral code was not found.", 400);
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + WINDOW_MS);
    await client.query("INSERT INTO referral_receipts(token_hash,referrer_id,expires_at) VALUES($1,$2,$3)",
      [tokenHash(token), member.id, expiresAt]);
    await client.query("COMMIT");
    return { token, expiresAt: expiresAt.toISOString() };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

type AccountCreatedAtResolver = (uid: string) => Promise<Date | string | null | undefined>;

export async function enrollReferralMember(
  identity: FilmmakerIdentity,
  receiptToken: unknown,
  // Injectable so integration tests need not call Firebase Admin.
  resolveCreatedAt: AccountCreatedAtResolver = getFirebaseAccountCreatedAt,
): Promise<string> {
  const id = referralIdentityId(identity);
  if ((await pool.query("SELECT id FROM referral_members WHERE id=$1", [id])).rowCount) return id;
  // Sign-in is Google (Firebase) only; its creation time proves a new signup.
  const accountCreatedAt = identity.provider === "firebase" ? await resolveCreatedAt(identity.uid) : null;
  if (!accountCreatedAt || !Number.isFinite(new Date(accountCreatedAt).getTime())) {
    throw new ReferralError("The account's signup date could not be verified.", 503);
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Account/email locks prevent duplicate registration across simultaneous tabs/providers.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`referral-email:${identity.email}`]);
    const existing = await client.query("SELECT id FROM referral_members WHERE id=$1 OR email=$2", [id, identity.email]);
    if (existing.rows.some(row => row.id !== id)) {
      throw new ReferralError("This email already participates through another sign-in method. Use that method for referrals.");
    }
    if (existing.rowCount) { await client.query("COMMIT"); return id; }
    let source: { referrer_id: string; captured_at: Date; expires_at: Date; consumed_by: string | null } | undefined;
    if (validToken(receiptToken)) {
      source = (await client.query("SELECT * FROM referral_receipts WHERE token_hash=$1 FOR UPDATE", [tokenHash(receiptToken)])).rows[0];
    }
    // Provider creation time, not a client timestamp or a first visit, proves a new signup.
    const attributable = source && canAttributeReferral({
      memberId: id, referrerId: source.referrer_id, accountCreatedAt: new Date(accountCreatedAt),
      capturedAt: source.captured_at, expiresAt: source.expires_at, consumedBy: source.consumed_by,
      accountTimestampPrecisionMs: 1000,
    });
    await client.query(`INSERT INTO referral_members(id,provider,uid,email,code,account_created_at,referred_by,attribution_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, identity.provider, identity.uid, identity.email, randomBytes(6).toString("hex").toUpperCase(),
      accountCreatedAt, attributable ? source!.referrer_id : null, attributable ? source!.captured_at : null]);
    if (source && validToken(receiptToken)) {
      await client.query("UPDATE referral_receipts SET consumed_by=$2 WHERE token_hash=$1 AND consumed_by IS NULL",
        [tokenHash(receiptToken), id]);
    }
    if (attributable) {
      const query = new PgDialect().sqlToQuery(referralRewardSyncSql(source!.referrer_id));
      await client.query(query.sql,query.params);
    }
    await client.query("COMMIT");
    return id;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

const REWARD_SELECT = `SELECT r.*, p.approved,p.hidden,p.showcase_requested,p.slug,p.review_decision,
  p.id AS live_project_id,p.review_paid_at
  FROM referral_rewards r LEFT JOIN projects p ON p.id=r.project_id`;

function rewardResponse(row: any, privateView = false): ReferralReward {
  let status = referralStatus(Boolean(row.paid_at), row.payment_status,
    isPublicReferralProject(row) && Boolean(row.review_paid_at));
  if (!row.paid_at && row.review_decision === "declined" && !isPublicReferralProject(row)) status = "cancelled";
  return {
    id: row.id, amount_cents: row.amount_cents, status,
    project_title: privateView ? null : row.project_title,
    payment_checked_at: iso(row.payment_checked_at), paid_at: iso(row.paid_at),
    payout_reference: privateView ? null : row.payout_reference,
    review_flag: Boolean(row.review_flag || status === "review_required"),
  };
}

export async function memberReferrals(id: string): Promise<ReferralMember> {
  await syncReferralRewards(id);
  const { rows: [member] } = await pool.query("SELECT code,referred_by FROM referral_members WHERE id=$1", [id]);
  const count = await pool.query("SELECT count(*)::int AS count FROM referral_members WHERE referred_by=$1", [id]);
  const { rows } = await pool.query(`${REWARD_SELECT} WHERE r.referrer_id=$1 ORDER BY r.created_at DESC`, [id]);
  const rewards = rows.map(row => rewardResponse(row, true));
  const signupCount = count.rows[0].count;
  return { code: member.code, referred_by: Boolean(member.referred_by), signup_count: signupCount,
    pending_count: signupCount - rewards.filter(r => r.status !== "pending").length,
    eligible_cents: rewards.filter(r => r.status === "eligible").reduce((n,r) => n+r.amount_cents,0),
    paid_cents: rewards.filter(r => r.paid_at).reduce((n,r) => n+r.amount_cents,0), rewards };
}

export async function referralLedger(page: number): Promise<ReferralLedger> {
  await syncReferralRewards();
  const pageSize = 25;
  const total = (await pool.query("SELECT count(*)::int AS count FROM referral_members WHERE referred_by IS NOT NULL")).rows[0].count;
  const { rows } = await pool.query(`SELECT m.id AS referral_id,m.email AS referred_email,m.account_created_at,
    parent.email AS referrer_email,r.id AS reward_id,r.project_id,r.project_title,r.amount_cents,r.payment_status,
    r.payment_checked_at,r.paid_at,r.payout_reference,r.review_flag,p.approved,p.hidden,p.showcase_requested,
    p.slug,p.review_paid_at,p.review_decision
    FROM referral_members m JOIN referral_members parent ON parent.id=m.referred_by
    LEFT JOIN referral_rewards r ON r.referred_id=m.id LEFT JOIN projects p ON p.id=r.project_id
    ORDER BY m.created_at DESC,m.id LIMIT $1 OFFSET $2`, [pageSize,(page-1)*pageSize]);
  return { page, page_size: pageSize, total, rows: rows.map(row => ({
    referral_id: row.referral_id, referrer_email: row.referrer_email, referred_email: row.referred_email,
    signed_up_at: iso(row.account_created_at)!, project_id: row.project_id ?? null,
    milestone: !row.reward_id ? "signed_up" : row.review_decision === "declined" ? "declined"
      : isPublicReferralProject(row) ? "listed" : row.hidden || row.approved ? "not_public" : "paid_pending_review",
    reward: row.reward_id ? rewardResponse({ ...row, id: row.reward_id }) : null,
  })) };
}

type PaymentVerifier = (sessionId: string, projectId: number) => Promise<ReferralPaymentStatus>;

export async function refreshReferralReward(id: number, verifier: PaymentVerifier = verifyReferralReviewPayment): Promise<ReferralReward> {
  const { rows: [before] } = await pool.query("SELECT session_id,project_id FROM referral_rewards WHERE id=$1", [id]);
  if (!before) throw new ReferralError("Referral reward not found.", 404);
  let status: ReferralPaymentStatus;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    status = await Promise.race([
      verifier(before.session_id, before.project_id),
      new Promise<never>((_,reject) => {
        timeout = setTimeout(() => reject(new Error("Verification timed out")),20_000);
        timeout.unref();
      }),
    ]);
  }
  catch { throw new ReferralError("Payment verification is unavailable. Do not send a payout; retry verification first."); }
  finally { if (timeout) clearTimeout(timeout); }
  await pool.query(`UPDATE referral_rewards SET payment_status=$2,payment_checked_at=now(),
    review_flag=(paid_at IS NOT NULL AND $2!='valid') WHERE id=$1`, [id,status]);
  return rewardResponse((await pool.query(`${REWARD_SELECT} WHERE r.id=$1`, [id])).rows[0]);
}

export async function recordReferralPayout(id: number, input: {
  reference: string; paid_on: string; confirmed_sent: boolean;
}, actor: string, verifier: PaymentVerifier = verifyReferralReviewPayment): Promise<ReferralReward> {
  const date = new Date(`${input.paid_on}T12:00:00Z`);
  if (!input.confirmed_sent) throw new ReferralError("Confirm that you already sent this payout.", 400);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== input.paid_on
    || input.paid_on > new Date().toISOString().slice(0,10)) {
    throw new ReferralError("Use a valid payout date that is not in the future.", 400);
  }
  const current = await refreshReferralReward(id, verifier);
  if (current.paid_at) throw new ReferralError("This referral payout is already recorded.");
  if (current.status !== "eligible") throw new ReferralError("Payment and approved public listing are required before recording a payout.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [row] } = await client.query("SELECT * FROM referral_rewards WHERE id=$1 FOR UPDATE", [id]);
    const { rows: [project] } = await client.query("SELECT * FROM projects WHERE id=$1 FOR SHARE", [row.project_id]);
    if (row.paid_at) throw new ReferralError("This referral payout is already recorded.");
    if (row.payment_status !== "valid" || !isPublicReferralProject(project) || !project?.review_paid_at) {
      throw new ReferralError("Eligibility changed. Verify the payment and public listing again.");
    }
    if (date < new Date(row.created_at.toISOString().slice(0,10))) {
      throw new ReferralError("The payout date cannot precede this referral reward.", 400);
    }
    await client.query(`UPDATE referral_rewards SET paid_at=$2,payout_reference=$3,paid_by=$4 WHERE id=$1`,
      [id,date,input.reference.trim(),actor]);
    await client.query("COMMIT");
  } catch (error: any) {
    await client.query("ROLLBACK");
    if (error?.code === "23505") throw new ReferralError("That payout reference has already been recorded.");
    throw error;
  } finally { client.release(); }
  return rewardResponse((await pool.query(`${REWARD_SELECT} WHERE r.id=$1`, [id])).rows[0]);
}