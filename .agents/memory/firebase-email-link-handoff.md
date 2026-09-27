---
name: Firebase email-link handoff
description: Browser-context constraints for automatic admin email-link completion.
---

Automatic email-link completion is appropriate when the return link can read the pending email saved on the same site in the same browser context. A link opened elsewhere must still ask for the recipient address; do not put that address into the continuation URL to bypass the check.

**Why:** Embedded previews can have storage partitioned differently from the top-level browser tab an email app opens. Firebase requires the address when completing an email-link sign-in to guard against session injection. Opening admin sign-in as a top-level tab before requesting the link reduces the preview-storage mismatch without weakening the fallback.

**How to apply:** When changing the admin login or its return URL, keep the callback on the same site, let an already-saved address complete automatically, and retain the manual-address fallback for genuinely separate browsers or storage partitions. Do not claim cross-browser automatic sign-in without designing a secure alternative.