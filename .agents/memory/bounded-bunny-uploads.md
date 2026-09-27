---
name: Bounded Bunny uploads
description: Why Movie Show Investing uses a server-bounded Bunny Stream upload path rather than relying only on signed direct uploads.
---

Enforce the advertised trailer size limit when bytes enter the upload path. Do not replace the bounded server stream with a signed direct-to-Bunny TUS session unless the provider can enforce the same cap before accepting bytes.

**Why:** A direct TUS client can upload more than the claimed limit and never call the application's finalization endpoint, leaving oversized media stored and billed despite a later size check.

**How to apply:** When changing upload transport or adding resumable uploads, require an upstream-enforced byte limit or a gateway that counts and aborts excessive bytes. A client-side limit and post-upload cleanup are useful but insufficient on their own.