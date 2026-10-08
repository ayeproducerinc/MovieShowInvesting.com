/** Verified Stripe evidence only: never pass browser-provided session data here. */
export const FREE99_PROMOTION_ID = "promo_1UOOcSKMfAphuictTPiYIH3b";
export const FREE99_COUPON_ID = "nabXgHId";
export type ReviewCheckoutKind = "paid" | "waived";
export type ReviewCheckoutExpected = {
  projectId: number; sessionId?: string; live: boolean; priceId: string;
};

const objectId = (value: any): string | undefined =>
  typeof value === "string" ? value : value?.id;

export function reviewSessionKind(session: any, expected: ReviewCheckoutExpected): ReviewCheckoutKind | null {
  if (typeof session?.id !== "string" || !session.id.startsWith(expected.live ? "cs_live_" : "cs_test_")
    || (expected.sessionId && session.id !== expected.sessionId)
    || session.livemode !== expected.live || session.client_reference_id !== String(expected.projectId)
    || session.metadata?.project_id !== String(expected.projectId)
    || session.mode !== "payment" || session.currency !== "usd"
    || session.amount_subtotal !== 4900 || session.total_details?.amount_tax !== 0
    || (session.total_details?.amount_shipping ?? 0) !== 0) return null;
  if (session.amount_total === 4900 && session.total_details?.amount_discount === 0) return "paid";
  // This owner-supplied promotion exists only in the approved live account.
  if (expected.live && session.amount_total === 0 && session.total_details?.amount_discount === 4900) return "waived";
  return null;
}

export function reviewLineItemsMatch(items: any, expected: ReviewCheckoutExpected, kind: ReviewCheckoutKind): boolean {
  const item = items?.data?.[0];
  return items?.has_more === false && items.data.length === 1
    && item?.price?.id === expected.priceId && item.quantity === 1
    && item.amount_subtotal === 4900 && item.amount_total === (kind === "waived" ? 0 : 4900)
    && item.currency === "usd";
}

export function free99EvidenceMatches(session: any, promotion: any, coupon: any, productId: string): boolean {
  const discounts = session?.discounts;
  const breakdown = session?.total_details?.breakdown?.discounts;
  const summaryMatch = Array.isArray(discounts) && discounts.length === 1
    && objectId(discounts[0].promotion_code) === FREE99_PROMOTION_ID
    && (!discounts[0].coupon || objectId(discounts[0].coupon) === FREE99_COUPON_ID);
  const breakdownMatch = Array.isArray(breakdown) && breakdown.length === 1
    && breakdown[0].amount === 4900
    && objectId(breakdown[0].discount?.promotion_code) === FREE99_PROMOTION_ID
    && objectId(breakdown[0].discount?.coupon) === FREE99_COUPON_ID;
  const linkedCoupon = promotion?.coupon ?? promotion?.promotion?.coupon;
  return (summaryMatch || breakdownMatch)
    && promotion?.id === FREE99_PROMOTION_ID && promotion.code === "FREE99"
    && promotion.livemode === true && objectId(linkedCoupon) === FREE99_COUPON_ID
    && coupon?.id === FREE99_COUPON_ID && coupon.livemode === true
    && coupon.percent_off === 100 && coupon.amount_off === null
    && (!coupon.applies_to || (Array.isArray(coupon.applies_to.products) && coupon.applies_to.products.includes(productId)));
  // Do not reject a completed redemption solely because the promotion subsequently
  // expired or exhausted its limits. Stripe enforces those limits at redemption.
}

/** A verified FREE99 waiver counts like a paid fee when the owner re-requests review. */
export function showcaseNeedsReviewFee(project: {
  reviewPaidAt?: Date | string | null; showcaseRequested?: boolean | null; approved?: boolean | null;
}, feeWaived: boolean): boolean {
  return !project.reviewPaidAt && !project.showcaseRequested && !project.approved && !feeWaived;
}

export function completedFreeReview(session: any): boolean {
  return session?.status === "complete" && session.payment_status === "no_payment_required"
    && session.payment_intent == null;
}
