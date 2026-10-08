import { test } from "node:test";
import assert from "node:assert/strict";
import { FREE99_PROMOTION_ID, FREE99_COUPON_ID, reviewSessionKind, reviewLineItemsMatch, free99EvidenceMatches, completedFreeReview, showcaseNeedsReviewFee } from "./review-checkout-policy";
import { classifyReferralPayment } from "./referral-policy";

const expected = { projectId: 99, sessionId: "cs_live_fixture", live: true, priceId: "price_fixture" };
const session = () => ({
  id: expected.sessionId, livemode: true, client_reference_id: "99", metadata: { project_id: "99" },
  mode: "payment", currency: "usd", amount_subtotal: 4900, amount_total: 0,
  total_details: { amount_discount: 4900, amount_tax: 0, amount_shipping: 0 },
  discounts: [{ promotion_code: FREE99_PROMOTION_ID, coupon: FREE99_COUPON_ID }],
  status: "complete", payment_status: "no_payment_required", payment_intent: null,
});
const coupon = () => ({ id: FREE99_COUPON_ID, livemode: true, percent_off: 100, amount_off: null });
const promotion = () => ({ id: FREE99_PROMOTION_ID, code: "FREE99", livemode: true, coupon: coupon() });
const items = () => ({ has_more: false, data: [{ price: { id: expected.priceId }, quantity: 1, amount_subtotal: 4900, amount_total: 0, currency: "usd" }] });

test("verified FREE99 completion uses a zero-dollar session without a payment intent", () => {
  assert.equal(reviewSessionKind(session(), expected), "waived");
  assert.equal(reviewLineItemsMatch(items(), expected, "waived"), true);
  assert.equal(free99EvidenceMatches(session(), promotion(), coupon(), "prod_review"), true);
  assert.equal(completedFreeReview(session()), true);
  assert.equal(classifyReferralPayment(session(), null, items(), expected), "unverified");
});
test("ordinary review amount remains exactly $49 with no discount", () => {
  const paid = { ...session(), amount_total: 4900, total_details: { amount_discount: 0, amount_tax: 0 } };
  assert.equal(reviewSessionKind(paid, expected), "paid");
  const paidItems = items(); paidItems.data[0].amount_total = 4900;
  assert.equal(reviewLineItemsMatch(paidItems, expected, "paid"), true);
  assert.equal(reviewSessionKind({ ...paid, amount_total: 4000 }, expected), null);
});
test("identity, environment, subtotal, tax and shipping mismatches are rejected", () => {
  for (const change of [
    { id: "cs_live_other" }, { id: "cs_test_fixture" }, { livemode: false },
    { client_reference_id: "100" }, { metadata: { project_id: "100" } },
    { currency: "eur" }, { mode: "subscription" }, { amount_subtotal: 0 },
    { total_details: { amount_discount: 4900, amount_tax: 1 } },
    { total_details: { amount_discount: 4900, amount_tax: 0, amount_shipping: 1 } },
  ]) assert.equal(reviewSessionKind({ ...session(), ...change }, expected), null);
});
test("wrong or missing promotion, coupon, percent, product and extra discounts are rejected", () => {
  assert.equal(free99EvidenceMatches({ ...session(), discounts: [] }, promotion(), coupon(), "prod_review"), false);
  assert.equal(free99EvidenceMatches({ ...session(), discounts: [{ promotion_code: "promo_other" }] }, promotion(), coupon(), "prod_review"), false);
  assert.equal(free99EvidenceMatches({ ...session(), discounts: [...session().discounts, ...session().discounts] }, promotion(), coupon(), "prod_review"), false);
  for (const change of [{ id: "promo_other" }, { code: "OTHER" }, { livemode: false }, { coupon: { id: "other" } }]) {
    assert.equal(free99EvidenceMatches(session(), { ...promotion(), ...change }, coupon(), "prod_review"), false);
  }
  for (const change of [{ id: "other" }, { livemode: false }, { percent_off: 50 }, { amount_off: 4900 }, { applies_to: { products: ["prod_other"] } }]) {
    assert.equal(free99EvidenceMatches(session(), promotion(), { ...coupon(), ...change }, "prod_review"), false);
  }
});
test("expanded Stripe discount breakdown and current promotion shape are supported", () => {
  const expanded = { ...session(), discounts: undefined, total_details: { ...session().total_details,
    breakdown: { discounts: [{ amount: 4900, discount: { promotion_code: { id: FREE99_PROMOTION_ID }, coupon: coupon() } }] } } };
  const modern = { ...promotion(), coupon: undefined, promotion: { type: "coupon", coupon: FREE99_COUPON_ID } };
  assert.equal(free99EvidenceMatches(expanded, modern, coupon(), "prod_review"), true);
  assert.equal(free99EvidenceMatches(expanded, { ...modern, active: false }, coupon(), "prod_review"), true);
});
test("cancelled, open, fake paid and intent-bearing free sessions cannot complete review", () => {
  for (const change of [{ status: "expired" }, { status: "open" }, { payment_status: "unpaid" }, { payment_status: "paid" }, { payment_intent: "pi_other" }]) {
    assert.equal(completedFreeReview({ ...session(), ...change }), false);
  }
});
test("re-requesting review needs a fee only when the pitch was never paid, waived, requested or approved", () => {
  const unpaid = { reviewPaidAt: null, showcaseRequested: false, approved: false };
  assert.equal(showcaseNeedsReviewFee(unpaid, false), true);
  assert.equal(showcaseNeedsReviewFee(unpaid, true), false);
  assert.equal(showcaseNeedsReviewFee({ ...unpaid, reviewPaidAt: new Date() }, false), false);
  assert.equal(showcaseNeedsReviewFee({ ...unpaid, showcaseRequested: true }, false), false);
  assert.equal(showcaseNeedsReviewFee({ ...unpaid, approved: true }, false), false);
});
test("wrong price, quantity, currency, amount or extra line items are rejected", () => {
  for (const change of [{ price: { id: "price_other" } }, { quantity: 2 }, { currency: "eur" }, { amount_subtotal: 0 }, { amount_total: 4900 }]) {
    assert.equal(reviewLineItemsMatch({ ...items(), data: [{ ...items().data[0], ...change }] }, expected, "waived"), false);
  }
  assert.equal(reviewLineItemsMatch({ has_more: true, data: items().data }, expected, "waived"), false);
  assert.equal(reviewLineItemsMatch({ has_more: false, data: [...items().data, ...items().data] }, expected, "waived"), false);
});
