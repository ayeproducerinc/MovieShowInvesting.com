---
name: Bunny video size semantics
description: Why Bunny Stream's storageSize must not be compared with the source video upload size.
---

Do not use Bunny Stream video metadata's `storageSize` to validate the uploaded source file's byte count or to apply a source-file size cap. Enforce the cap while receiving the source bytes and treat a successful HTTP upload plus a valid non-error provider status as confirmation.

**Why:** A live upload probe returned `storageSize = 0` immediately after Bunny accepted the file; after transcoding it reported a value much larger than the source MP4. An equality check rejected and deleted valid uploads.

**How to apply:** If adding remote integrity checks, use a documented source-file checksum such as `originalHash` when available. Do not infer source size from post-encoding storage accounting.