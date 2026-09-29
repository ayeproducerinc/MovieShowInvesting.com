import { randomUUID } from "node:crypto";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { db, pitchReviewCheckoutsTable, projectsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "./logger";

const SANDBOX_ACCOUNT = "acct_1UKlvzI6ABsowmLh";
const SANDBOX_PRICE = "price_1UKmPMI6ABsowmLhzyjaBfRh";
const LIVE_ACCOUNT = "acct_1PLbbtKMfAphuict";
const LIVE_PRICE = "price_1UKnz1KMfAphuictkykZarYT";
const LIVE_PRODUCT = "prod_VLUy0ncPWUpyhn";
const connectors = new ReplitConnectors();
const live = () => process.env.NODE_ENV === "production";
const priceId = () => live() ? LIVE_PRICE : SANDBOX_PRICE;

export async function reviewCheckoutConfig() {
  let enabled = false;
  try {
    await assertAccount();
    enabled = true;
  } catch {
    // Never advertise checkout until the connected account and price are verified.
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

function validSession(session: any, projectId: number, sessionId?: string): boolean {
  return (!sessionId || session.id === sessionId)
    && session.livemode === live() && session.client_reference_id === String(projectId)
    && session.metadata?.project_id === String(projectId)
    && session.mode === "payment" && session.currency === "usd"
    && session.amount_total === 4900 && session.amount_subtotal === 4900
    && session.total_details?.amount_discount === 0
    && session.total_details?.amount_tax === 0;
}

export async function startReviewCheckout(projectId: number, visitorId: string): Promise<string> {
  await assertAccount();
  const [existing] = await db.select().from(pitchReviewCheckoutsTable)
    .where(and(eq(pitchReviewCheckoutsTable.projectId, projectId), eq(pitchReviewCheckoutsTable.state, "open")))
    .limit(1);
  if (existing) {
    if (!existing.sessionId.startsWith(live() ? "cs_live_" : "cs_test_")) {
      throw new Error("An earlier or uncertain checkout requires manual reconciliation");
    }
    const previous = await stripe(`/v1/checkout/sessions/${encodeURIComponent(existing.sessionId)}`);
    if (!validSession(previous, projectId, existing.sessionId)) throw new Error("Existing checkout identity mismatch");
    if (previous.payment_status === "paid") {
      await reconcileOne(existing);
      throw new Error("A review payment has already been received");
    }
    if (previous.status === "open" && previous.url) return previous.url;
    if (previous.status !== "expired") throw new Error("An earlier checkout is still being verified");
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
    client_reference_id: String(projectId),
    "metadata[project_id]": String(projectId),
    "payment_intent_data[metadata][project_id]": String(projectId),
    "custom_text[submit][message]": live()
      ? "This $49 fee covers editorial review of one completed pitch. Approval or public listing is not guaranteed. A completed review that declines a pitch is not automatically refunded. If we cannot deliver the review, we will refund the fee, subject to applicable law."
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
  const session = await stripe(`/v1/checkout/sessions/${encodeURIComponent(row.sessionId)}`);
  if (!validSession(session, row.projectId, row.sessionId)) throw new Error("Checkout identity or amount does not match the stored pitch");
  const items = await stripe(`/v1/checkout/sessions/${encodeURIComponent(row.sessionId)}/line_items?limit=2`);
  if (items.has_more || items.data?.length !== 1 || items.data[0].price?.id !== priceId()
    || items.data[0].quantity !== 1 || items.data[0].amount_total !== 4900) {
    throw new Error("Checkout line item does not match the review price");
  }
  if (session.payment_status !== "paid" || session.status !== "complete") {
    if (session.status === "expired" && session.payment_status !== "paid") {
      await db.update(pitchReviewCheckoutsTable).set({ state: "closed" })
        .where(and(eq(pitchReviewCheckoutsTable.sessionId, row.sessionId), eq(pitchReviewCheckoutsTable.state, "open")));
    }
    return;
  }
  if (typeof session.payment_intent !== "string") throw new Error("Paid checkout has no verifiable payment intent");
  const intent = await stripe(`/v1/payment_intents/${encodeURIComponent(session.payment_intent)}?expand[]=latest_charge`);
  if (intent.livemode !== live() || intent.status !== "succeeded" || intent.currency !== "usd"
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
  await db.transaction(async (tx) => {
    const [stored] = await tx.select().from(pitchReviewCheckoutsTable)
      .where(eq(pitchReviewCheckoutsTable.sessionId, row.sessionId)).for("update");
    if (!stored || stored.state !== "open") return;
    const [project] = await tx.select().from(projectsTable)
      .where(eq(projectsTable.id, row.projectId)).for("update");
    if (!project || !project.slug || project.hidden || project.approved || project.showcaseRequested || project.reviewPaidAt) {
      throw new Error("Paid pitch is missing or no longer eligible; manual fulfillment required");
    }
    await tx.update(pitchReviewCheckoutsTable)
      .set({ state: "paid", paidAt: new Date() })
      .where(eq(pitchReviewCheckoutsTable.sessionId, row.sessionId));
    await tx.update(projectsTable)
      .set({ reviewPaidAt: new Date(), showcaseRequested: true, reviewDecision: null })
      .where(eq(projectsTable.id, row.projectId));
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
      logger.warn({ error, projectId: row.projectId }, "Review checkout needs individual reconciliation");
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