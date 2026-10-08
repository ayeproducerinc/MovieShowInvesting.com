# Pitch review live checkout — launch record and re-verification checklist

Live checkout is **launched**: the app is published and taking live review payments (reported by the owner, October 2026). Known open payment issues are tracked in [stripe-payment-fixes-plan.md](stripe-payment-fixes-plan.md). The notes below are the original launch record; the checklist is kept for re-verifying after any deploy or Stripe change.

AYe Producer, Inc.'s Stripe live account is `acct_1PLbbtKMfAphuict`. The active, fixed, one-time USD $49.00 live price `price_1UKnz1KMfAphuictkykZarYT` belongs to the active "Movie Show Investing Pitch Review" product `prod_VLUy0ncPWUpyhn` (verified by reading both resources in the live account). The app's development connector points to a different test account; do not use its test price or a generic Payment Link in production. The production connector still needs to be verified against the live account and must support Checkout Session creation and retrieval of sessions, line items, payment intents, and charges. Stripe rejected product creation through the agent's live connection with a permissions error; the owner created the price in the live Dashboard instead.

## Approved customer-facing wording

The live pre-checkout screen shows:

> **Editorial review · $49 per pitch**
>
> **Submit your pitch for review**
>
> **$49 one time.** This pays for editorial review of this pitch. Approval is not guaranteed. If approved, we’ll list it in the public Pitch Collection with no preset expiration date.
>
> After we complete your review, a declined pitch is not automatically refunded. If we cannot deliver the review, we’ll refund the payment, subject to applicable law. You can leave checkout before paying; cancelling checkout does not submit the pitch for review.
>
> We’re building the Pitch Collection that investors will be able to browse when they join.
>
> **Continue to checkout**

The Stripe-hosted Checkout submit text is:

> This $49 fee covers editorial review of one completed pitch. Approval or public listing is not guaranteed. A completed review that declines a pitch is not automatically refunded. If we cannot deliver the review, we will refund the fee, subject to applicable law.

The Stripe product name is **Movie Show Investing Pitch Review**; its description is also **Movie Show Investing Pitch Review**. The longer cancellation wording above appears on the app's pre-checkout screen, not in the Stripe-hosted submit text. The owner approved both this wording and making the payment available.

## Re-verification checklist (originally the pre-launch checklist)

1. The owner approved the exact review scope and cancellation/refund wording above and expressly requested that checkout be made available. Editorial review covers **one completed pitch**; approval and public listing are **not guaranteed**; a completed declined review is **not automatically refunded**; inability to deliver review is **refunded subject to applicable law**. Cancellation before payment does not submit the pitch. Do not add testing-environment or repeated charge warnings to live customer copy.
2. The verified live price ID above is configured directly in the server code for live Checkout Sessions, separate from the test price. Verify the production runtime's Stripe connector returns the exact live account above and can retrieve that price; development credentials are not proof of production access.
3. The published app's production Stripe connection must point to AYe Producer, Inc.'s live account. In production `/api/filmmakers/review-checkout/config` reports `enabled: true` only when the account and $49 price can be verified; otherwise it reports `enabled: false` and POST cannot start checkout. Check the return domain and confirm the published app reaches the API. Existing free pitches remain unlisted until their filmmakers complete checkout.
4. Exercise per-pitch matching, account/price/amount checks, paid-to-review transitions, duplicate requests, cancellation, ambiguous payment and return status **with test payments**. Do not use a real card just to test; any live charge requires separate informed authorization. Confirm the admin queue says pending and Explore does not list a pitch until explicit owner approval. Check Stripe-hosted checkout displays the approved review terms and price before accepting payments.
5. The owner has authorized go-live; no additional price ID or payment-link creation is needed. A dedicated Checkout Session is generated for each selected completed pitch; a reusable Payment Link would not identify the pitch. No live payment should be made merely to test without separate informed authorization. Existing open live checkouts still require server-side reconciliation; don't change the configured price while payments may be in flight.

The filmmaker-facing review action is displayed only when the API verifies the live account and price. The development preview must not offer a test checkout on the filmmaker screen; internal test payments may still exercise the API directly.

## Operational controls

- On uncertain Stripe results or an orphaned `pending:` checkout reservation, **do not** delete the reservation or ask the filmmaker to pay again. Reconcile the Stripe session and payment with the pitch before releasing the reservation. Expired sessions are automatically closed only after verification.
- The review queue is populated only after server-side verification of session, single $49 price line item, live account, payment intent, and unrefunded charge. A return URL alone is never proof of payment. Review payment does not approve Explore listing.
- A later refund or dispute requires an operator to review the pitch and unapprove/unlist it as appropriate; the current automatic reconciliation checks charge refund/dispute **at fulfillment time**, not continuously after a pitch enters review. Establish the operator procedure before declaring checkout operational.
- If the live connection cannot be verified, do not substitute another Stripe account, a test link, or a manual payment. The free unlisted pitch remains saved.