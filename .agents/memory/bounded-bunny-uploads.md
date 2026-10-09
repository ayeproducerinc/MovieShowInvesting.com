---
name: Bounded Bunny uploads
description: Why Movie Show Investing uses a server-bounded Bunny Stream upload path rather than relying only on signed direct uploads.
---

Enforce the advertised trailer size limit when bytes enter the upload path. Do not replace the bounded server stream with a signed direct-to-Bunny TUS session unless the provider can enforce the same cap before accepting bytes.

**Why:** A direct TUS client can upload more than the claimed limit and never call the application's finalization endpoint, leaving oversized media stored and billed despite a later size check.

**How to apply:** When changing upload transport or adding resumable uploads, require an upstream-enforced byte limit or a gateway that counts and aborts excessive bytes. A client-side limit and post-upload cleanup are useful but insufficient on their own.
Trailers now upload in pieces (<=16 MB each) because the deployment proxy refuses single requests over ~32 MB: the browser posts pieces to `/api/filmmakers/{draft,project}-materials/trailer/chunk` and the API forwards them to Bunny Stream TUS (`lib/trailer-upload-session.ts`). The API creates the TUS upload with `Upload-Length`, so the cap is enforced by Bunny, and the TUS URL travels only inside an AES-GCM-sealed token. Keep the browser from talking to Bunny directly.
