---
name: Guest review checkout handoff
description: Safe recovery when an immediate guest confirmation outlives its visitor cookie during review checkout.
---

Keep checkout recovery limited to the exact completed pitch and its review payment/status. Never expose or store the HttpOnly visitor identifier in browser storage or let checkout proof authorize editing, project claims, or other private data. Signed-in recovery must prove account ownership of that project.

**Why:** A completed pitch could render its confirmation while a subsequent checkout request was rejected before reaching Stripe because the visit context was missing. Recreating the pitch or letting a project ID alone authorize payment would be unsafe.

**How to apply:** If a guest checkout needs a fallback, use a time-limited, server-issued pitch-scoped capability and recheck completed-project ownership and account linkage on every use. Do not broaden that capability to other endpoints.