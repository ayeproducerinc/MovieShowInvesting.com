import { beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { resetFixture } from "./review-checkout.test-fixture";
import {
  startReviewCheckout, reconcileReviewCheckouts, reviewFeeWaived, reviewCheckoutConfig,
  reviewCheckoutNeedsAttention, resetReviewAccountCacheForTests,
} from "./pitch-review-payments";
import { FREE99_PROMOTION_ID, FREE99_COUPON_ID } from "./review-checkout-policy";
import "./review-checkout-policy.test";
import "./referral-policy.test";
import "./pledge-policy.test";
import "./backer-visibility.test";
import "./project-updates.test";
import "./project-update-email.test";
import "./update-email-preference.test";
import "./update-metrics.test";
import "./money-date.test";

process.env.NODE_ENV = "production"; // Test-double provider only; never calls live Stripe.
process.env.REPLIT_DOMAINS = "checkout-fixture.example";
const sid = "cs_live_fixture";
function responses(kind: "paid" | "waived" = "waived") {
  const free = kind === "waived";
  return {
    "/v1/account": { id: "acct_1PLbbtKMfAphuict" },
    "/v1/prices/price_1UKnz1KMfAphuictkykZarYT": { active: true, livemode: true, currency: "usd", unit_amount: 4900, type: "one_time", product: "prod_VLUy0ncPWUpyhn" },
    [`/v1/checkout/sessions/${sid}`]: {
      id: sid, livemode: true, client_reference_id: "99", metadata: { project_id: "99" },
      mode: "payment", currency: "usd", amount_subtotal: 4900, amount_total: free ? 0 : 4900,
      total_details: { amount_discount: free ? 4900 : 0, amount_tax: 0 },
      discounts: free ? [{ promotion_code: FREE99_PROMOTION_ID, coupon: FREE99_COUPON_ID }] : [],
      status: "complete", payment_status: free ? "no_payment_required" : "paid", payment_intent: free ? null : "pi_fixture",
    },
    [`/v1/checkout/sessions/${sid}/line_items`]: { has_more: false, data: [{
      price: { id: "price_1UKnz1KMfAphuictkykZarYT" }, quantity: 1, currency: "usd", amount_subtotal: 4900, amount_total: free ? 0 : 4900,
    }] },
    [`/v1/promotion_codes/${FREE99_PROMOTION_ID}`]: { id: FREE99_PROMOTION_ID, code: "FREE99", livemode: true, coupon: { id: FREE99_COUPON_ID } },
    [`/v1/coupons/${FREE99_COUPON_ID}`]: { id: FREE99_COUPON_ID, livemode: true, percent_off: 100, amount_off: null },
    "/v1/payment_intents/pi_fixture": { id: "pi_fixture", livemode: true, status: "succeeded", currency: "usd", amount: 4900, amount_received: 4900,
      metadata: { project_id: "99" }, latest_charge: { livemode: true, payment_intent: "pi_fixture", amount: 4900, currency: "usd",
        paid: true, refunded: false, amount_refunded: 0, disputed: false } },
  } as Record<string, any>;
}
const open = () => [{ sessionId: sid, projectId: 99, visitorId: "fixture", state: "open", paidAt: null }];
beforeEach(() => resetReviewAccountCacheForTests());

test("free completion submits once without marking paid or creating referral rewards", async () => {
  const s = resetFixture(responses(), open());
  await reconcileReviewCheckouts(99);
  assert.equal(s.rows[0].state, "waived"); assert.equal(s.rows[0].paidAt, null);
  assert.equal(s.projects[0].reviewPaidAt, null); assert.equal(s.projects[0].showcaseRequested, true);
  assert.equal(s.rewards, 0); assert.equal(await reviewFeeWaived(99), true);
  assert.equal(s.requests.some(r => r.path.includes("payment_intents")), false);
  const n = s.requests.length;
  await reconcileReviewCheckouts(99);
  assert.equal(s.requests.length, n); assert.equal(s.rewards, 0);
  await assert.rejects(startReviewCheckout(99, "fixture"), /fee-waived review/);
});
test("ordinary $49 completion remains paid and synchronizes referral eligibility", async () => {
  const s = resetFixture(responses("paid"), open());
  await reconcileReviewCheckouts(99);
  assert.equal(s.rows[0].state, "paid"); assert.ok(s.rows[0].paidAt);
  assert.ok(s.projects[0].reviewPaidAt); assert.equal(s.projects[0].showcaseRequested, true);
  assert.equal(s.rewards, 1); assert.equal(await reviewFeeWaived(99), false);
  await reconcileReviewCheckouts(99); assert.equal(s.rewards, 1);
});
test("unsupported promotion is flagged for an operator, leaves pitch unsubmitted, and blocks another checkout", async () => {
  const r = responses(); r[`/v1/checkout/sessions/${sid}`].discounts[0].promotion_code = "promo_other";
  const s = resetFixture(r, open());
  await reconcileReviewCheckouts(99);
  assert.equal(s.rows[0].state, "needs_attention"); assert.equal(s.projects[0].showcaseRequested, false);
  assert.equal(s.rewards, 0); assert.equal(await reviewCheckoutNeedsAttention(99), true);
  const n = s.requests.length;
  await reconcileReviewCheckouts(99);
  assert.equal(s.requests.length, n);
  await assert.rejects(startReviewCheckout(99, "fixture"), /awaiting manual review/);
  assert.equal(s.requests.some(x => x.path === "/v1/checkout/sessions"), false);
});
test("partially discounted paid completion is flagged rather than retried forever", async () => {
  const r = responses("paid");
  Object.assign(r[`/v1/checkout/sessions/${sid}`], { amount_total: 2450, total_details: { amount_discount: 2450, amount_tax: 0 } });
  const s = resetFixture(r, open());
  process.env.ADMIN_EMAIL = "admin@checkout-fixture.example";
  try { await reconcileReviewCheckouts(99); } finally { delete process.env.ADMIN_EMAIL; }
  assert.equal(s.rows[0].state, "needs_attention"); assert.equal(s.projects[0].reviewPaidAt, null);
  assert.equal(s.rewards, 0);
  // Mail is unconfigured in tests; the alert is still attempted and logged once.
  assert.deepEqual(s.emails.map(e => e.type), ["review_checkout_attention"]);
});
test("an incomplete session with an unexpected amount still waits instead of being flagged", async () => {
  const r = responses("paid");
  Object.assign(r[`/v1/checkout/sessions/${sid}`], { status: "open", payment_status: "unpaid", amount_total: 2450,
    total_details: { amount_discount: 2450, amount_tax: 0 } });
  const s = resetFixture(r, open());
  await assert.rejects(reconcileReviewCheckouts(99), /does not match the stored pitch/);
  assert.equal(s.rows[0].state, "open");
});
test("cancelled checkout closes the reservation without submitting the pitch", async () => {
  const r = responses("paid"); Object.assign(r[`/v1/checkout/sessions/${sid}`], { status: "expired", payment_status: "unpaid", payment_intent: null });
  const s = resetFixture(r, open());
  await reconcileReviewCheckouts(99);
  assert.equal(s.rows[0].state, "closed"); assert.equal(s.projects[0].showcaseRequested, false);
});
test("open zero-dollar checkout remains pending, even with approved promotion", async () => {
  const r = responses(); Object.assign(r[`/v1/checkout/sessions/${sid}`], { status: "open", payment_status: "unpaid" });
  const s = resetFixture(r, open()); await reconcileReviewCheckouts(99);
  assert.equal(s.rows[0].state, "open"); assert.equal(s.projects[0].showcaseRequested, false);
});
test("new checkout permits customer codes but never pre-applies FREE99", async () => {
  const r = responses("paid");
  r["/v1/checkout/sessions"] = { ...r[`/v1/checkout/sessions/${sid}`], status: "open", payment_status: "unpaid", payment_intent: null, url: "https://checkout.stripe.com/c/pay/fixture" };
  const s = resetFixture(r);
  assert.equal(await startReviewCheckout(99, "fixture"), r["/v1/checkout/sessions"].url);
  const form = new URLSearchParams(s.requests.find(r => r.path === "/v1/checkout/sessions")?.body);
  assert.equal(form.get("allow_promotion_codes"), "true");
  assert.equal(form.has("payment_method_collection"), false);
  assert.equal([...form.keys()].some(k => k.startsWith("discounts")), false);
  assert.equal(s.rows[0].sessionId, sid);
});

const pending = (version = "v2:", age = 60_000) => [{
  sessionId: `pending:${version}00000000-0000-4000-8000-000000000099`,
  projectId: 99, visitorId: "fixture", state: "open", paidAt: null, createdAt: new Date(Date.now() - age),
}];
const providerError = (status: number, type: string) => ({
  __status: status, __body: { error: { type, param: "payment_method_collection" } },
});
function openCreated(r: Record<string, any>) {
  return { ...r[`/v1/checkout/sessions/${sid}`], status: "open", payment_status: "unpaid",
    payment_intent: null, allow_promotion_codes: true, url: "https://checkout.stripe.com/c/pay/fixture" };
}
test("definitive Stripe creation failure releases only its reservation and permits retry", async () => {
  const r = responses("paid"); r["/v1/checkout/sessions"] = providerError(400, "invalid_request_error");
  const s = resetFixture(r);
  await assert.rejects(startReviewCheckout(99, "fixture"), /Stripe request failed/);
  assert.equal(s.rows[0].state, "creation_failed"); assert.equal(s.projects[0].showcaseRequested, false);
  r["/v1/checkout/sessions"] = openCreated(r);
  await startReviewCheckout(99, "fixture");
  assert.equal(s.rows.length, 2); assert.equal(s.rows[1].sessionId, sid);
});
test("legacy failed request is replayed with its original key and released after definitive rejection", async () => {
  const r = responses("paid"); r["/v1/checkout/sessions"] = providerError(400, "invalid_request_error");
  const row = pending("")[0], s = resetFixture(r, [row]);
  await reconcileReviewCheckouts(99);
  assert.equal(row.state, "creation_failed"); assert.equal(s.projects[0].showcaseRequested, false);
  const request = s.requests.find(x => x.path === "/v1/checkout/sessions")!;
  assert.equal(request.headers?.["Idempotency-Key"], row.sessionId);
  assert.equal(new URLSearchParams(request.body).get("payment_method_collection"), "if_required");
});
test("uncertain timeout is retained and recovered with the same idempotency key", async () => {
  const r = responses("paid"); r["/v1/checkout/sessions"] = new Error("fixture timeout");
  const s = resetFixture(r);
  await assert.rejects(startReviewCheckout(99, "fixture"), /timeout/);
  assert.equal(s.rows[0].state, "open");
  const reservation = s.rows[0].sessionId;
  s.rows[0].createdAt = new Date(Date.now() - 60_000);
  r["/v1/checkout/sessions"] = { ...openCreated(r), metadata: { project_id: "99", checkout_reservation: reservation } };
  await reconcileReviewCheckouts(99);
  assert.equal(s.rows.length, 1); assert.equal(s.rows[0].sessionId, sid);
  const requests = s.requests.filter(x => x.path === "/v1/checkout/sessions");
  assert.equal(requests[0].headers?.["Idempotency-Key"], requests[1].headers?.["Idempotency-Key"]);
  assert.equal(requests[0].body, requests[1].body);
});
test("provider success followed by local persistence failure recovers the original Checkout", async () => {
  const r = responses("paid");
  r["/v1/checkout/sessions"] = (options: any) => ({
    ...openCreated(r), metadata: { project_id: "99", checkout_reservation: options.headers["Idempotency-Key"] },
  });
  const s = resetFixture(r); s.failSessionPersistence = 1;
  await assert.rejects(startReviewCheckout(99, "fixture"), /persistence/);
  assert.ok(s.rows[0].sessionId.startsWith("pending:v2:"));
  s.rows[0].createdAt = new Date(Date.now() - 60_000);
  await reconcileReviewCheckouts(99);
  assert.equal(s.rows[0].sessionId, sid); assert.equal(s.rows.length, 1);
  const requests = s.requests.filter(x => x.path === "/v1/checkout/sessions");
  assert.equal(requests[0].body, requests[1].body);
  assert.equal(requests[0].headers?.["Idempotency-Key"], requests[1].headers?.["Idempotency-Key"]);
});
test("a recovered completed waived session is fulfilled once rather than creating a second review", async () => {
  const r = responses(), row = pending()[0];
  r["/v1/checkout/sessions"] = { ...r[`/v1/checkout/sessions/${sid}`], metadata: { project_id: "99", checkout_reservation: row.sessionId } };
  const s = resetFixture(r, [row]);
  await reconcileReviewCheckouts(99); await reconcileReviewCheckouts(99);
  assert.equal(s.rows[0].state, "waived"); assert.equal(s.rewards, 0);
  assert.equal(s.projects[0].showcaseRequested, true);
  assert.equal(s.requests.filter(x => x.path === "/v1/checkout/sessions").length, 1);
});
test("idempotency conflict, provider failure and timeout never release uncertain pending rows", async () => {
  for (const error of [providerError(400, "idempotency_error"), providerError(500, "api_error"), new Error("timeout")]) {
    const r = responses("paid"); r["/v1/checkout/sessions"] = error;
    const s = resetFixture(r, pending());
    await assert.rejects(reconcileReviewCheckouts(99));
    assert.equal(s.rows[0].state, "open"); assert.equal(s.projects[0].showcaseRequested, false);
  }
});
test("just-started reservations cannot be replayed or silently cleared", async () => {
  const s = resetFixture(responses("paid"), pending("v2:", 0));
  await assert.rejects(reconcileReviewCheckouts(99), /manual reconciliation/);
  assert.equal(s.rows[0].state, "open");
  assert.equal(s.requests.some(x => x.path.startsWith("/v1/checkout/sessions")), false);
});
const listOnly = (list: any) => (options?: { body?: string }) => options?.body !== undefined
  ? new Error("expired reservations must never be replayed") : list;
test("expired reservations are released only after Stripe lists no Checkout for the pitch", async () => {
  for (const [version, age] of [["v2:", 20 * 60 * 60 * 1000], ["v2:", 25 * 60 * 60 * 1000], ["", 72 * 60 * 60 * 1000]] as const) {
    const r = responses("paid");
    r["/v1/checkout/sessions"] = listOnly({ has_more: false, data: [{ id: "cs_live_unrelated", client_reference_id: "12" }] });
    const s = resetFixture(r, pending(version, age));
    await reconcileReviewCheckouts(99);
    assert.equal(s.rows[0].state, "creation_failed"); assert.equal(s.projects[0].showcaseRequested, false);
    assert.ok(s.requests.some(x => x.path.startsWith("/v1/checkout/sessions?created")));
    assert.equal(s.requests.some(x => x.path === "/v1/checkout/sessions" && x.body !== undefined), false);
  }
});
test("an expired reservation with a matching Stripe Checkout is flagged and blocks another charge", async () => {
  const r = responses("paid");
  r["/v1/checkout/sessions"] = listOnly({ has_more: false, data: [{ id: sid, client_reference_id: "99" }] });
  const s = resetFixture(r, pending("v2:", 25 * 60 * 60 * 1000));
  await reconcileReviewCheckouts(99);
  assert.equal(s.rows[0].state, "needs_attention");
  await assert.rejects(startReviewCheckout(99, "fixture"), /awaiting manual review/);
});
test("a failed, malformed or capped Stripe listing keeps the expired reservation blocked", async () => {
  for (const list of [providerError(400, "invalid_request_error"), { data: "malformed" },
    { has_more: true, data: [{ id: "cs_live_page", client_reference_id: "12" }] }]) {
    const r = responses("paid"); r["/v1/checkout/sessions"] = listOnly(list);
    const s = resetFixture(r, pending("v2:", 25 * 60 * 60 * 1000));
    await assert.rejects(reconcileReviewCheckouts(99));
    assert.equal(s.rows[0].state, "open");
  }
});
test("concurrent creation attempts can reserve only one open Checkout", async () => {
  const r = responses("paid"); r["/v1/checkout/sessions"] = openCreated(r);
  const s = resetFixture(r);
  const results = await Promise.allSettled([startReviewCheckout(99, "fixture"), startReviewCheckout(99, "fixture")]);
  assert.equal(results.filter(x => x.status === "fulfilled").length, 1);
  assert.equal(s.rows.length, 1);
  assert.equal(s.requests.filter(x => x.path === "/v1/checkout/sessions").length, 1);
});
test("a legacy unpaid checkout is expired before a code-enabled replacement is created", async () => {
  const r = responses("paid");
  Object.assign(r[`/v1/checkout/sessions/${sid}`], { status: "open", payment_status: "unpaid", payment_intent: null,
    allow_promotion_codes: false, payment_method_collection: "always", url: "https://checkout.stripe.com/c/pay/old" });
  r[`/v1/checkout/sessions/${sid}/expire`] = { ...r[`/v1/checkout/sessions/${sid}`], status: "expired" };
  r["/v1/checkout/sessions"] = { ...r[`/v1/checkout/sessions/${sid}`], id: "cs_live_replacement", url: "https://checkout.stripe.com/c/pay/new" };
  const s = resetFixture(r, open());
  assert.equal(await startReviewCheckout(99, "fixture"), r["/v1/checkout/sessions"].url);
  assert.equal(s.rows[0].state, "closed"); assert.equal(s.rows[1].state, "open");
  assert.equal(s.rows[1].sessionId, "cs_live_replacement");
  assert.ok(s.requests.findIndex(x => x.path.endsWith("/expire")) < s.requests.findIndex(x => x.path === "/v1/checkout/sessions"));
});
test("an already code-enabled open checkout is reused without expiration or duplication", async () => {
  const r = responses("paid");
  Object.assign(r[`/v1/checkout/sessions/${sid}`], { status: "open", payment_status: "unpaid", payment_intent: null,
    allow_promotion_codes: true, payment_method_collection: "if_required", url: "https://checkout.stripe.com/c/pay/current" });
  const s = resetFixture(r, open());
  assert.equal(await startReviewCheckout(99, "fixture"), r[`/v1/checkout/sessions/${sid}`].url);
  assert.equal(s.rows.length, 1); assert.equal(s.requests.some(x => x.path.endsWith("/expire") || x.path === "/v1/checkout/sessions"), false);
});
test("failed legacy expiration never opens another checkout or closes the reservation", async () => {
  const r = responses("paid");
  Object.assign(r[`/v1/checkout/sessions/${sid}`], { status: "open", payment_status: "unpaid", url: "https://checkout.stripe.com/c/pay/old" });
  const s = resetFixture(r, open());
  await assert.rejects(startReviewCheckout(99, "fixture"), /Stripe request failed/);
  assert.equal(s.rows.length, 1); assert.equal(s.rows[0].state, "open");
  assert.equal(s.requests.some(x => x.path === "/v1/checkout/sessions"), false);
});
test("an unverified account fails closed and leaves the checkout open for retry", async () => {
  const r = responses("paid"); r["/v1/account"].id = "acct_other";
  const s = resetFixture(r, open());
  await assert.rejects(reconcileReviewCheckouts(99));
  assert.equal(s.rows[0].state, "open"); assert.equal(s.projects[0].showcaseRequested, false);
  assert.equal(s.rewards, 0);
});
test("refunded paid charge and ineligible pitch are flagged without fulfillment", async () => {
  for (const variant of ["refund", "hidden"]) {
    const r = responses("paid");
    if (variant === "refund") r["/v1/payment_intents/pi_fixture"].latest_charge.refunded = true;
    const s = resetFixture(r, open());
    if (variant === "hidden") s.projects[0].hidden = true;
    await reconcileReviewCheckouts(99);
    assert.equal(s.rows[0].state, "needs_attention"); assert.equal(s.projects[0].showcaseRequested, false);
    assert.equal(s.projects[0].reviewPaidAt, null); assert.equal(s.rewards, 0);
  }
});
test("account and price verification is shared across requests", async () => {
  const s = resetFixture(responses("paid"));
  assert.equal((await reviewCheckoutConfig()).enabled, true);
  assert.equal((await reviewCheckoutConfig()).enabled, true);
  assert.equal(s.requests.filter(x => x.path === "/v1/account").length, 1);
  assert.equal(s.requests.filter(x => x.path.startsWith("/v1/prices/")).length, 1);
});
test("a failed account check is cached briefly and then retried", async () => {
  mock.timers.enable({ apis: ["Date"], now: Date.now() });
  try {
    const r = responses("paid"); r["/v1/account"].id = "acct_other";
    const s = resetFixture(r);
    assert.equal((await reviewCheckoutConfig()).enabled, false);
    r["/v1/account"].id = "acct_1PLbbtKMfAphuict";
    assert.equal((await reviewCheckoutConfig()).enabled, false);
    assert.equal(s.requests.filter(x => x.path === "/v1/account").length, 1);
    mock.timers.tick(31_000);
    assert.equal((await reviewCheckoutConfig()).enabled, true);
    assert.equal(s.requests.filter(x => x.path === "/v1/account").length, 2);
  } finally { mock.timers.reset(); }
});
