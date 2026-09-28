import { ReplitConnectors } from "@replit/connectors-sdk";
import { db, pitchReviewCheckoutsTable, projectsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "./logger";

// This pilot is deliberately limited to the connected Movie Show Investing test account.
const SANDBOX_ACCOUNT = "acct_1UKlvzI6ABsowmLh";
const PRICE = "price_1UKmPMI6ABsowmLhzyjaBfRh";
const connectors = new ReplitConnectors();

async function stripe(path: string, options?: { method: string; body: string; headers: Record<string, string> }): Promise<any> {
  const response = await connectors.proxy("stripe", path, options);
  if (!response.ok) throw new Error(`Stripe sandbox request failed (${response.status})`);
  return response.json();
}

async function assertSandbox(): Promise<void> {
  if (process.env.NODE_ENV === "production") throw new Error("Sandbox checkout is disabled in production");
  const account = await stripe("/v1/account");
  if (account.id !== SANDBOX_ACCOUNT) throw new Error("The connected Stripe account is not the approved sandbox");
}

export async function startReviewCheckout(projectId: number, visitorId: string): Promise<string> {
  await assertSandbox();
  const [existing] = await db.select().from(pitchReviewCheckoutsTable)
    .where(and(eq(pitchReviewCheckoutsTable.projectId, projectId), eq(pitchReviewCheckoutsTable.state, "open")))
    .limit(1);
  if (existing) {
    const previous = await stripe(`/v1/checkout/sessions/${encodeURIComponent(existing.sessionId)}`);
    if (previous.status === "open" && previous.url && previous.livemode === false
      && previous.client_reference_id === String(projectId) && previous.amount_total === 4900) return previous.url;
    if (previous.payment_status === "paid") {
      await reconcileOne(existing);
      throw new Error("A review payment has already been received");
    }
    if (previous.status === "complete") throw new Error("A checkout is still being confirmed");
    await db.update(pitchReviewCheckoutsTable).set({ state: "closed" })
      .where(eq(pitchReviewCheckoutsTable.sessionId, existing.sessionId));
  }
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
  if (!domain || !/^[a-z0-9.-]+$/i.test(domain)) throw new Error("A development preview domain is required for sandbox checkout");
  const form = new URLSearchParams({
    mode: "payment",
    "payment_method_types[0]": "card",
    "line_items[0][price]": PRICE,
    "line_items[0][quantity]": "1",
    client_reference_id: String(projectId),
    "metadata[project_id]": String(projectId),
    "custom_text[submit][message]": "The $49 fee pays for editorial review, not approval. A completed review is not automatically refunded if the pitch is declined.",
    success_url: `https://${domain}/start/filmmaker/done?review_checkout=return&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `https://${domain}/start/filmmaker/done?review_checkout=cancelled`,
  });
  const session = await stripe("/v1/checkout/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  if (!session.id || !session.url || session.livemode !== false || session.amount_total !== 4900 || session.currency !== "usd") {
    throw new Error("Stripe did not return the expected $49 test checkout");
  }
  await db.insert(pitchReviewCheckoutsTable).values({ sessionId: session.id, projectId, visitorId });
  return session.url;
}

async function reconcileOne(row: typeof pitchReviewCheckoutsTable.$inferSelect): Promise<void> {
  await assertSandbox();
  const session = await stripe(`/v1/checkout/sessions/${encodeURIComponent(row.sessionId)}`);
  if (session.id !== row.sessionId || session.client_reference_id !== String(row.projectId)
    || session.metadata?.project_id !== String(row.projectId) || session.livemode !== false
    || session.mode !== "payment" || session.currency !== "usd" || session.amount_total !== 4900) {
    throw new Error("Checkout identity or amount does not match the stored pitch");
  }
  if (session.payment_status !== "paid") {
    if (session.status === "expired") {
      await db.update(pitchReviewCheckoutsTable).set({ state: "closed" })
        .where(and(eq(pitchReviewCheckoutsTable.sessionId, row.sessionId), eq(pitchReviewCheckoutsTable.state, "open")));
    }
    return;
  }
  await db.transaction(async (tx) => {
    const [stored] = await tx.select().from(pitchReviewCheckoutsTable)
      .where(eq(pitchReviewCheckoutsTable.sessionId, row.sessionId)).for("update");
    if (!stored || stored.state !== "open") return;
    const [project] = await tx.select().from(projectsTable)
      .where(eq(projectsTable.id, row.projectId)).for("update");
    if (!project) throw new Error("Paid pitch no longer exists");
    await tx.update(pitchReviewCheckoutsTable)
      .set({ state: "paid", paidAt: new Date() })
      .where(eq(pitchReviewCheckoutsTable.sessionId, row.sessionId));
    if (!project.reviewPaidAt) {
      await tx.update(projectsTable)
        .set({ reviewPaidAt: new Date(), showcaseRequested: true, reviewDecision: null })
        .where(eq(projectsTable.id, row.projectId));
    }
  });
}

export async function reconcileReviewCheckouts(projectId?: number): Promise<void> {
  const open = await db.select().from(pitchReviewCheckoutsTable)
    .where(projectId == null
      ? eq(pitchReviewCheckoutsTable.state, "open")
      : and(eq(pitchReviewCheckoutsTable.state, "open"), eq(pitchReviewCheckoutsTable.projectId, projectId)))
    .limit(50);
  for (const row of open) await reconcileOne(row);
}

export function startReviewCheckoutReconciliation(): void {
  const timer = setInterval(() => {
    void reconcileReviewCheckouts().catch((error: unknown) => {
      logger.warn({ error }, "Sandbox checkout reconciliation failed");
    });
  }, 60_000);
  timer.unref();
}