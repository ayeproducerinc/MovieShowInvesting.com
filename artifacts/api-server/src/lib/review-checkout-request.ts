/** Persisted reservation prefixes version the exact Stripe request for safe replay. */
export const CHECKOUT_REPLAY_WINDOW_MS = 20 * 60 * 60 * 1000;
export const CHECKOUT_SETTLE_MS = 30_000;

export function reviewCheckoutForm(projectId: number, reservation: string, price: string, domain: string, live: boolean) {
  const current = reservation.startsWith("pending:v2:");
  const form = new URLSearchParams({
    mode: "payment",
    "payment_method_types[0]": "card",
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    allow_promotion_codes: "true",
    client_reference_id: String(projectId),
    "metadata[project_id]": String(projectId),
    "payment_intent_data[metadata][project_id]": String(projectId),
    "custom_text[submit][message]": live
      ? "Editorial review of one completed pitch costs $49 before any eligible promotion. Your final total is shown above. Approval or public listing is not guaranteed. A declined pitch is not automatically refunded. If we cannot deliver the review, we will refund any fee paid, subject to applicable law."
      : "TEST CHECKOUT ONLY. No charge. Editorial review does not guarantee approval.",
    success_url: `https://${domain}/start/filmmaker/done?review_checkout=return&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `https://${domain}/start/filmmaker/done?review_checkout=cancelled`,
  });
  if (current) form.set("metadata[checkout_reservation]", reservation);
  else {
    // Replay ONLY with the original key and inside Stripe's retention window.
    // Stripe rejects this legacy option for one-time prices; a cached, definitive
    // invalid_request_error proves this attempt did not produce a Checkout.
    form.set("payment_method_collection", "if_required");
  }
  return form;
}

const safeIdentifier = (value: unknown): string | undefined =>
  typeof value === "string" && /^[a-zA-Z0-9_[\].:-]{1,120}$/.test(value) ? value : undefined;

export class ReviewStripeError extends Error {
  constructor(
    readonly status: number,
    readonly stripeType?: string,
    readonly stripeCode?: string,
    readonly parameter?: string,
    readonly requestId?: string,
  ) {
    super(`Stripe request failed (${status})`);
  }
}

export function providerFailure(status: number, body: any, requestId: string | null) {
  return new ReviewStripeError(status, safeIdentifier(body?.error?.type),
    safeIdentifier(body?.error?.code), safeIdentifier(body?.error?.param), safeIdentifier(requestId));
}

export function isDefinitiveCreationFailure(error: unknown): error is ReviewStripeError {
  // Do not release on idempotency conflicts, timeouts, rate limits, transport
  // failures, or provider 5xx responses. Their creation outcome is uncertain.
  return error instanceof ReviewStripeError && error.status === 400
    && error.stripeType === "invalid_request_error";
}
