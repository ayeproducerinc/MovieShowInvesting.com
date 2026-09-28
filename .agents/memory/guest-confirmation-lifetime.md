---
name: Guest confirmation lifetime
description: Owner-approved boundary between the immediate guest receipt and later account access.
---

Show a first guest submission's confirmation without sign-in, and allow refreshes while they remain on that page. Once they leave the page or close its tab, returning to the saved submission requires email sign-in in the original browser. Never remove the project, public link, or original-browser claim proof to enforce this display boundary.

**Why:** The owner wants an immediate, useful receipt without blocking intake on authentication, but does not want a completed guest worksheet to reopen silently later. Browser back/forward caching can restore a page whose original navigation type was a reload, so a reload marker alone is not evidence the guest never left.

**How to apply:** Separate page-display permission from project ownership. Permit a genuine same-tab reload, revoke display permission on SPA navigation or a pagehide/back-forward return, and keep the ownership cookie intact for verified-email claiming.