---
name: Analytics capture boundary
description: Privacy boundary for analytics on private investor and filmmaker forms.
---

For this product, explicit low-cardinality analytics events are preferable to broad autocapture or session replay while forms contain private investor contact and accreditation information. A vendor-provided installation snippet may enable recordings by default; do not copy those settings into the app without a separate privacy review.

**Why:** Capture of every click or recorded session can collect sensitive form content or behavioral data before masking and consent are settled, even when the project token itself is public.

**How to apply:** Instrument named events without names, emails, phone numbers, signatures, or raw answers. Keep production analytics disabled until the owner-approved privacy/consent work is finished; require an explicit decision and appropriate masking before enabling Clarity or Mixpanel replay.