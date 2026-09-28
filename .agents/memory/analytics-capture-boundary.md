---
name: Analytics capture boundary
description: Privacy boundary for analytics on private investor and filmmaker forms.
---

For this product, explicit low-cardinality analytics events are preferable to broad autocapture while forms contain private investor contact and accreditation information. The owner approved opt-in masked Mixpanel replay on public pages only, with private investor, filmmaker, message, and account areas excluded. A vendor-provided installation snippet may enable recordings by default; do not copy those settings into the app without a separate privacy review.

The owner confirmed that the development Mixpanel connection worked with this restricted setup. This confirmation does not establish production event delivery.

If a second replay provider is introduced, require a fresh opt-in rather than treating the old Mixpanel-only choice as permission for both. Mask the entire allowed public-page content, not just selected form controls. For a provider without a supported pause/stop API, unload its script before displaying any private SPA route and after consent withdrawal, including history restoration or another tab changing the choice.

**Why:** Capture of every click or recorded session can collect sensitive form content or behavioral data before masking and consent are settled, even when the project token itself is public.

**How to apply:** Instrument named events without names, emails, phone numbers, signatures, or raw answers. New pages default to replay-excluded until explicitly reviewed. Mask all text and inputs, disable console/network capture, and offer a withdrawal control for approved public-page replay. Keep production analytics disabled until launch privacy review is finished; require a separate decision before enabling Clarity or private-page replay.