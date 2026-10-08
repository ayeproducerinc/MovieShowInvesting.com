# Stripe payment fixes

Status: **done in code (October 2026), pending deploy.** Constraint kept: Stripe keys, IDs, prices, the Replit Stripe connector and customer-facing checkout wording are unchanged.

## 1. A customer could pay and never get their review — fixed ("catch & flag")
The Stripe promo-code box is unchanged. If Stripe reports a **completed** checkout that the app can't fulfil automatically (a non-FREE99 or partial discount, a line-item mismatch, failed FREE99 evidence, a refunded or disputed charge, or a pitch hidden or approved mid-checkout):
- The checkout row moves from `open` to `needs_attention` (`artifacts/api-server/src/lib/pitch-review-payments.ts`, `flagCheckout`), so the reconcile loop stops retrying it.
- An alert email goes to `ADMIN_EMAIL` (type `review_checkout_attention`).
- It appears first in the admin **Queues** table as "Payment issue · Urgent".
- A new checkout for that pitch is refused, so the customer can't be charged twice.
- The owner's status shows the review as **pending**, not unpaid.

Incomplete sessions and Stripe or network errors still just retry. Resolve flagged items by hand (see `docs/pitch-review-live-checkout.md`).

## 2. A failed Stripe call could lock a pitch out of checkout — fixed
- The Replit commit `f4707eb` added replay with the original idempotency key, and release on a definitive Stripe 400, within 20 hours.
- New: past 20 hours, the app lists Stripe Checkout sessions around the reservation time (bounded to 10 pages).
  - **No session for the pitch:** the reservation is released (`creation_failed`).
  - **A matching session:** it is flagged `needs_attention`.
  - **A listing that fails or is capped:** it stays blocked.

## 3. A waived pitch couldn't be resubmitted — fixed
The showcase 402 gate treats a verified FREE99 waiver like a paid fee (`showcaseNeedsReviewFee` in `review-checkout-policy.ts`, used by `routes/filmmaker.ts`).

## 4. Checkout endpoints called Stripe without limit — fixed
- The account and price check is cached for 5 minutes (failures for 30 seconds).
- `GET /api/filmmakers/review-checkout/config` and `/status` are limited to 60 requests per IP per 5 minutes (`lib/rate-limit.ts`). The status page normally polls about 15 times per 5 minutes.

## Before relying on it in production
- On Replit: run `node scripts/test-review-checkouts.mjs`.
- In the sandbox, confirm Stripe accepts the `created[gte]`/`created[lte]` filter on the Checkout session list. If it doesn't, old reservations simply stay blocked as before, which is safe.

## Still open (business decisions, not started)
- One payment covers unlimited re-reviews: declined pitches can be toggled off and on, and approved pitches go back to review after edits (`lib/db/src/index.ts:1084-1087`).
- Live versus test mode depends only on `NODE_ENV` (`pitch-review-payments.ts`).
- There is no Stripe webhook, so refunds and disputes after fulfilment aren't detected.
- Check the FREE99 `max_redemptions` setting in the Stripe dashboard.
- `routes/pitch-review-checkout.ts` `UUID` pattern has only 4 groups (8-4-4-12), so the guest visitor-cookie fallback never matches a real visitor ID. Guests rely on the checkout proof instead. Fixing it would re-enable that fallback; decide before changing it.
