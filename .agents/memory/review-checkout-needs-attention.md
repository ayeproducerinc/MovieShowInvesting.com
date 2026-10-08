---
name: Review checkout needs_attention state
description: Completed-but-unfulfillable checkouts are flagged for an operator instead of retried forever
---

`pitch_review_checkouts.state = 'needs_attention'` marks a Checkout Stripe reports as complete that cannot be fulfilled automatically (non-FREE99/partial discount, mismatch, refund/dispute, pitch hidden or approved mid-checkout), or an expired reservation whose Stripe listing shows a matching session.

**Why:** Leaving such rows `open` retried them every minute forever while a customer could already have paid, with only a log warning.

**How to apply:** Only completed sessions are flagged; provider/network errors and incomplete sessions still retry. A flagged row blocks new checkouts for the pitch, reports `pending` on status, alerts `ADMIN_EMAIL`, and lists first in admin Queues. Resolution is manual (see `docs/pitch-review-live-checkout.md`).
