import { randomUUID } from "node:crypto";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { db, pitchReviewCheckoutsTable, projectsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "./logger";
import { classifyReferralPayment, type ReferralPaymentStatus } from "./referral-policy";
import { referralRewardSyncSql } from "./referral-reward-sync";
import { FREE99_PROMOTION_ID, FREE99_COUPON_ID, reviewSessionKind, reviewLineItemsMatch, free99EvidenceMatches, completedFreeReview } from "./review-checkout-policy";

const SANDBOX_ACCOUNT = "acct_1UKlvzI6ABsowmLh";
const SANDBOX_PRICE = "price_1UKmPMI6ABsowmLhzyjaBfRh";
const LIVE_ACCOUNT = "acct_1PLbbtKMfAphuict";
const LIVE_PRICE = "price_1UKnz1KMfAphuictkykZarYT";
const LIVE_PRODUCT = "prod_VLUy0ncPWUpyhn";
const connectors = new ReplitConnectors();
const live = () => process.env.NODE_ENV === "production";
const priceId = () => live() ? LIVE_PRICE : SANDBOX_PRICE;

function safeCheckoutFailure(error: unknown): string {
  if (error instanceof Error && (
    error.message === "Connected Stripe account does not match the approved payment environment"
    || error.message === "Review price does not match the approved one-time $49 offer"
    || /^Stripe request failed \(\d{3}\)$/.test(error.message)
    || error.message === "Checkout environment or reservation requires manual reconciliation"
  )) return error.message;
  return "Stripe connection or checkout could not be verified";
}

export async function reviewCheckoutConfig() {
  let enabled = false;
  try {
    await assertAccount();
    enabled = true;
  } catch (error) {
    // Never advertise checkout until the connected account and price are verified.
    logger.warn({ reason: safeCheckoutFailure(error) }, "Pitch review checkout unavailable");
  }
  return { mode: live() ? "live" as const : "sandbox" as const, enabled };
}

async function stripe(path: string, options?: { method: string; body: string; headers: Record<string, string> }): Promise<any> {
  const response = await connectors.proxy("stripe", path, options);
  if (!response.ok) throw new Error(`Stripe request failed (${response.status})`);
  return response.json();
}

async function assertAccount(): Promise<void> {
  const account = await stripe("/v1/account");
  if (account.id !== (live() ? LIVE_ACCOUNT : SANDBOX_ACCOUNT)) throw new Error("Connected Stripe account does not match the approved payment environment");
  const price = await stripe(`/v1/prices/${encodeURIComponent(priceId()!)}`);
  if (!price.active || price.livemode !== live() || price.currency !== "usd" || price.unit_amount !== 4900
    || price.type !== "one_time" || price.recurring || price.custom_unit_amount
    || (live() && price.product !== LIVE_PRODUCT)) {
    throw new Error("Review price does not match the approved one-time $49 offer");
  }
}

/** Read-only current provider evidence. No charges, refunds or payouts are made. */
export async function verifyReferralReviewPayment(sessionId: string, projectId: number): Promise<ReferralPaymentStatus> {
  if (!sessionId.startsWith(live() ? "cs_live_" : "cs_test_")) return "unverified";
  await assertAccount();
  const session = await stripe(`/v1/checkout/sessions/${encodeURIComponent(sessionId)}`);
  if (typeof session.payment_intent !== "string") return "unverified";
  const [intent, items] = await Promise.all([
    stripe(`/v1/payment_intents/${encodeURIComponent(session.payment_intent)}?expand[]=latest_charge`),
    stripe(`/v1/checkout/sessions/${encodeURIComponent(sessionId)}/line_items?limit=2`),
  ]);
  return classifyReferralPayment(session, intent, items, {
    sessionId, projectId, live: live(), priceId: priceId(),
  });
}

function validSession(session: any, projectId: number, sessionId?: string): boolean {
  return reviewSessionKind(session, { projectId, sessionId, live: live(), priceId: priceId() }) !== null;
}

export async function reviewFeeWaived(projectId: number): Promise<boolean> {
  const [row] = await db.select({ sessionId: pitchReviewCheckoutsTable.sessionId }).from(pitchReviewCheckoutsTable)
    .where(and(eq(pitchReviewCheckoutsTable.projectId, projectId), eq(pitchReviewCheckoutsTable.state, "waived"))).limit(1);
  return Boolean(row);
}

export async function startReviewCheckout(projectId: number, visitorId: string): Promise<string> {
  await assertAccount();
  if (await reviewFeeWaived(projectId)) throw new Error("This pitch has already received a fee-waived review");
  const [existing] = await db.select().from(pitchReviewCheckoutsTable)
    .where(and(eq(pitchReviewCheckoutsTable.projectId, projectId), eq(pitchReviewCheckoutsTable.state, "open")))
    .limit(1);
  if (existing) {
    if (!existing.sessionId.startsWith(live() ? "cs_live_" : "cs_test_")) {
      throw new Error("An earlier or uncertain checkout requires manual reconciliation");
    }
    const previous = await stripe(`/v1/checkout/sessions/${encodeURIComponent(existing.sessionId)}`);
    if (!validSession(previous, projectId, existing.sessionId)) throw new Error("Existing checkout identity mismatch");
    if (previous.status === "complete" || previous.payment_status === "paid") {
      await reconcileOne(existing);
      throw new Error("This review checkout has already been completed");
    }
    if (previous.status === "open" && previous.url) {
      if (previous.allow_promotion_codes === true && previous.payment_method_collection === "if_required") return previous.url;
      // A legacy unpaid Checkout cannot have these options changed in place.
      // Expire it before reserving a replacement; if a payment wins the race,
      // Stripe refuses expiration and we must not create another checkout.
      const expired = await stripe(`/v1/checkout/sessions/${encodeURIComponent(existing.sessionId)}/expire`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": `promo-upgrade:${existing.sessionId}` },
        body: "",
      });
      if (!validSession(expired, projectId, existing.sessionId) || expired.status !== "expired" || expired.payment_status === "paid") {
        throw new Error("An earlier checkout is still being verified");
      }
    } else if (previous.status !== "expired") throw new Error("An earlier checkout is still being verified");
    await db.update(pitchReviewCheckoutsTable).set({ state: "closed" })
      .where(eq(pitchReviewCheckoutsTable.sessionId, existing.sessionId));
  }
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
  if (!domain || !/^[a-z0-9.-]+$/i.test(domain)) throw new Error("A valid checkout return domain is required");
  // Reserve the pitch before calling Stripe. If Stripe succeeds but persistence fails,
  // the reservation blocks a second charge until an operator reconciles it.
  const reservation = `pending:${randomUUID()}`;
  await db.insert(pitchReviewCheckoutsTable).values({ sessionId: reservation, projectId, visitorId });
  const form = new URLSearchParams({
    mode: "payment",
    "payment_method_types[0]": "card",
    "line_items[0][price]": priceId()!,
    "line_items[0][quantity]": "1",
    allow_promotion_codes: "true",
    payment_method_collection: "if_required",
    client_reference_id: String(projectId),
    "metadata[project_id]": String(projectId),
    "payment_intent_data[metadata][project_id]": String(projectId),
    "custom_text[submit][message]": live()
      ? "Editorial review of one completed pitch costs $49 before any eligible promotion. Your final total is shown above. Approval or public listing is not guaranteed. A declined pitch is not automatically refunded. If we cannot deliver the review, we will refund any fee paid, subject to applicable law."
      : "TEST CHECKOUT ONLY. No charge. Editorial review does not guarantee approval.",
    success_url: `https://${domain}/start/filmmaker/done?review_checkout=return&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `https://${domain}/start/filmmaker/done?review_checkout=cancelled`,
  });
  const session = await stripe("/v1/checkout/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": reservation },
    body: form.toString(),
  });
  if (!session.id?.startsWith(live() ? "cs_live_" : "cs_test_")
    || !session.url?.startsWith("https://checkout.stripe.com/")
    || !validSession(session, projectId) || session.status !== "open") {
    throw new Error("Stripe did not return the expected pitch-specific checkout");
  }
  await db.update(pitchReviewCheckoutsTable).set({ sessionId: session.id })
    .where(eq(pitchReviewCheckoutsTable.sessionId, reservation));
  return session.url;
}

async function reconcileOne(row: typeof pitchReviewCheckoutsTable.$inferSelect): Promise<void> {
  if (!row.sessionId.startsWith(live() ? "cs_live_" : "cs_test_")) {
    throw new Error("Checkout environment or reservation requires manual reconciliation");
  }
  await assertAccount();
  const session = await stripe(`/v1/checkout/sessions/${encodeURIComponent(row.sessionId)}?expand[]=total_details.breakdown`);
  const expected = { projectId: row.projectId, sessionId: row.sessionId, live: live(), priceId: priceId() };
  const kind = reviewSessionKind(session, expected);
  if (!kind) throw new Error("Checkout identity or amount does not match the stored pitch");
  const items = await stripe(`/v1/checkout/sessions/${encodeURIComponent(row.sessionId)}/line_items?limit=2`);
  if (!reviewLineItemsMatch(items, expected, kind)) {
    throw new Error("Checkout line item does not match the review price");
  }
  if (session.status !== "complete") {
    if (session.status === "expired" && session.payment_status !== "paid") {
      await db.update(pitchReviewCheckoutsTable).set({ state: "closed" })
        .where(and(eq(pitchReviewCheckoutsTable.sessionId, row.sessionId), eq(pitchReviewCheckoutsTable.state, "open")));
    }
    return;
  }
  if (kind === "waived") {
    const [promotion, coupon] = await Promise.all([
      stripe(`/v1/promotion_codes/${FREE99_PROMOTION_ID}`),
      stripe(`/v1/coupons/${FREE99_COUPON_ID}`),
    ]);
    if (!completedFreeReview(session) || !free99EvidenceMatches(session, promotion, coupon, LIVE_PRODUCT)) {
      throw new Error("Free review does not match the approved FREE99 promotion");
    }
  } else {
    if (session.payment_status !== "paid") return;
    if (typeof session.payment_intent !== "string") throw new Error("Paid checkout has no verifiable payment intent");
    const intent = await stripe(`/v1/payment_intents/${encodeURIComponent(session.payment_intent)}?expand[]=latest_charge`);
    if (intent.id !== session.payment_intent || intent.livemode !== live() || intent.status !== "succeeded" || intent.currency !== "usd"
      || intent.amount_received !== 4900 || intent.amount !== 4900
      || intent.metadata?.project_id !== String(row.projectId)
      || !intent.latest_charge || typeof intent.latest_charge !== "object"
      || intent.latest_charge.livemode !== live()
      || intent.latest_charge.payment_intent !== intent.id
      || intent.latest_charge.amount !== 4900 || intent.latest_charge.currency !== "usd"
      || intent.latest_charge.paid !== true || intent.latest_charge.refunded
      || intent.latest_charge.amount_refunded !== 0 || intent.latest_charge.disputed) {
      throw new Error("Payment intent is not a settled, unrefunded review payment");
    }
  }
  await db.transaction(async (tx) => {
    const [stored] = await tx.select().from(pitchReviewCheckoutsTable)
      .where(eq(pitchReviewCheckoutsTable.sessionId, row.sessionId)).for("update");
    if (!stored || stored.state !== "open") return;
    const [project] = await tx.select().from(projectsTable)
      .where(eq(projectsTable.id, row.projectId)).for("update");
    if (!project || !project.slug || project.hidden || project.approved || project.showcaseRequested || project.reviewPaidAt) {
      throw new Error("Completed review pitch is missing or no longer eligible; manual fulfillment required");
    }
    await tx.update(pitchReviewCheckoutsTable)
      .set({ state: kind, paidAt: kind === "paid" ? new Date() : null })
      .where(eq(pitchReviewCheckoutsTable.sessionId, row.sessionId));
    await tx.update(projectsTable)
      .set({ reviewPaidAt: kind === "paid" ? new Date() : null, showcaseRequested: true, reviewDecision: null })
      .where(eq(projectsTable.id, row.projectId));
    if (kind === "paid") await tx.execute(referralRewardSyncSql());
  });
}

export async function reconcileReviewCheckouts(projectId?: number): Promise<void> {
  const open = await db.select().from(pitchReviewCheckoutsTable)
    .where(projectId == null
      ? eq(pitchReviewCheckoutsTable.state, "open")
      : and(eq(pitchReviewCheckoutsTable.state, "open"), eq(pitchReviewCheckoutsTable.projectId, projectId)));
  for (const row of open) {
    try {
      await reconcileOne(row);
    } catch (error) {
      // A targeted request must surface uncertainty to that pitch's owner.
      // Background reconciliation must not let one unresolved reservation
      // prevent an unrelated completed payment from reaching review.
      if (projectId != null) throw error;
      logger.warn({ reason: safeCheckoutFailure(error), projectId: row.projectId }, "Review checkout needs individual reconciliation");
    }
  }
}

export function startReviewCheckoutReconciliation(): void {
  const timer = setInterval(() => {
    if (live() && !priceId()) return;
    void reconcileReviewCheckouts().catch((error: unknown) => {
      logger.warn({ error }, "Review checkout reconciliation failed");
    });
  }, 60_000);
  timer.unref();
}