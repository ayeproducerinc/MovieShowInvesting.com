---
name: Stripe checkout idempotency
description: Cached creation failures require the exact original request before safe recovery
---

Some Stripe Checkout business-validation failures are cached under the original idempotency key. Do not assume every `invalid_request_error` permits changing the parameters and retrying the same key.

**Why:** A failed one-time checkout returned an idempotency conflict when replayed with a different return domain, but returned its original definitive validation rejection when replayed with the original domain and parameters. No session was created.

**How to apply:** Preserve versioned request shapes and the original runtime return-domain semantics when recovering reservations. Only a definitive provider rejection can release an attempt for a new key; conflicts, timeouts and provider failures remain uncertain. Never replay after the provider's guaranteed key-retention window without separate evidence.

One-time Checkout must not use the subscription-only `payment_method_collection` option. Promotion-code entry is independent of that option.

**Why:** Both approved sandbox and live accounts rejected this option on a one-time review price; the corrected sandbox request was accepted.

**How to apply:** Confirm real provider acceptance of checkout parameter changes, not just fixture responses. Keep live redemption evidence separate from sandbox creation and browser simulations.
