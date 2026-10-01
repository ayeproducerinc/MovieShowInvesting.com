---
name: Fixture cleanup evidence
description: Preserve restricted provider-cleanup evidence separately from temporary test credentials.
---

Separate test credentials from the restricted inventory of generated provider assets before cleanup. Remove credentials promptly, but keep an unresolved-asset manifest until exact remote deletions are verified. The manifest must exclude auth tokens, keys, signed URLs, and personal filenames.

**Why:** A timed-out fixture cleanup lost its only recorded remote asset paths. Test users and database rows were gone, but remote deletion could no longer be independently confirmed. Enumerating shared provider storage to recover those paths would risk unrelated media.

**How to apply:** Record only precisely known generated asset keys, use bounded provider requests, retain failed cleanup evidence, and verify deletion before discarding that inventory. Never claim remote cleanup succeeded solely because the database or credential file was removed.