import { test } from "node:test";
import assert from "node:assert/strict";
import { resetFixture } from "./review-checkout.test-fixture";
import { startReviewCheckout, reconcileReviewCheckouts, reviewFeeWaived } from "./pitch-review-payments";
import { FREE99_PROMOTION_ID, FREE99_COUPON_ID } from "./review-checkout-policy";
import "./review-checkout-policy.test";
import "./referral-policy.test";

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
test("unsupported promotion fails closed and leaves pitch unsubmitted", async () => {
  const r = responses(); r[`/v1/checkout/sessions/${sid}`].discounts[0].promotion_code = "promo_other";
  const s = resetFixture(r, open());
  await assert.rejects(reconcileReviewCheckouts(99), /approved FREE99/);
  assert.equal(s.rows[0].state, "open"); assert.equal(s.projects[0].showcaseRequested, false);
  assert.equal(s.rewards, 0);
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
  assert.equal(form.get("payment_method_collection"), "if_required");
  assert.equal([...form.keys()].some(k => k.startsWith("discounts")), false);
  assert.equal(s.rows[0].sessionId, sid);
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
test("account, refunded paid charge and ineligible pitch fail without fulfillment", async () => {
  for (const variant of ["account", "refund", "hidden"]) {
    const r = responses("paid");
    if (variant === "account") r["/v1/account"].id = "acct_other";
    if (variant === "refund") r["/v1/payment_intents/pi_fixture"].latest_charge.refunded = true;
    const s = resetFixture(r, open());
    if (variant === "hidden") s.projects[0].hidden = true;
    await assert.rejects(reconcileReviewCheckouts(99));
    assert.equal(s.rows[0].state, "open"); assert.equal(s.projects[0].showcaseRequested, false);
    assert.equal(s.rewards, 0);
  }
});
