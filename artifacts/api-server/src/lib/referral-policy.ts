export type ReferralPaymentStatus = "valid" | "refunded" | "disputed" | "unverified";
export type ReferralStatus = "pending" | "eligible" | "paid" | "cancelled" | "review_required";

export function isPublicReferralProject(project: {
  approved?: boolean | null; hidden?: boolean | null;
  showcase_requested?: boolean | null; slug?: string | null;
} | null): boolean {
  return Boolean(project?.approved && project.showcase_requested && !project.hidden && project.slug);
}

export function referralStatus(paid: boolean, payment: ReferralPaymentStatus, isPublic: boolean): ReferralStatus {
  if (paid) return payment === "valid" ? "paid" : "review_required";
  if (payment === "refunded" || payment === "disputed") return "cancelled";
  return payment === "valid" && isPublic ? "eligible" : "pending";
}

export function canAttributeReferral(input: {
  memberId: string; referrerId: string; accountCreatedAt: Date;
  capturedAt: Date; expiresAt: Date; consumedBy: string | null;
  accountTimestampPrecisionMs?: number;
}, now = new Date()): boolean {
  return input.memberId !== input.referrerId
    && !input.consumedBy && input.expiresAt > now
    // Firebase Admin formats creationTime as whole-second UTC; honor that precision.
    && input.accountCreatedAt.getTime() + (input.accountTimestampPrecisionMs ?? 1) > input.capturedAt.getTime()
    && input.accountCreatedAt <= now;
}

// All identity/amount/environment checks must pass BEFORE classifying a refund.
export function classifyReferralPayment(session: any, intent: any, items: any, expected: {
  sessionId: string; projectId: number; live: boolean; priceId: string;
}): ReferralPaymentStatus {
  const projectId = String(expected.projectId);
  const charge = intent?.latest_charge;
  if (session?.id !== expected.sessionId || session.livemode !== expected.live
    || session.client_reference_id !== projectId || session.metadata?.project_id !== projectId
    || session.mode !== "payment" || session.currency !== "usd"
    || session.amount_total !== 4900 || session.amount_subtotal !== 4900
    || session.total_details?.amount_discount !== 0 || session.total_details?.amount_tax !== 0
    || session.payment_status !== "paid" || session.status !== "complete"
    || typeof session.payment_intent !== "string" || session.payment_intent !== intent?.id
    || items?.has_more || items?.data?.length !== 1
    || items.data[0].price?.id !== expected.priceId || items.data[0].quantity !== 1
    || items.data[0].amount_total !== 4900
    || intent?.livemode !== expected.live || intent.status !== "succeeded"
    || intent.currency !== "usd" || intent.amount_received !== 4900 || intent.amount !== 4900
    || intent.metadata?.project_id !== projectId
    || !charge || typeof charge !== "object" || charge.livemode !== expected.live
    || charge.payment_intent !== intent.id || charge.amount !== 4900
    || charge.currency !== "usd" || charge.paid !== true) {
    return "unverified";
  }
  if (charge.disputed === true) return "disputed";
  if (charge.refunded === true || Number(charge.amount_refunded) > 0) return "refunded";
  return charge.refunded === false && charge.amount_refunded === 0 && charge.disputed === false
    ? "valid" : "unverified";
}