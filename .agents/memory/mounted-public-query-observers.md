---
name: Mounted public query observers
description: Authentication cache clearing can detach a still-mounted public page from later query updates.
---

When authentication changes but a public page remains mounted, preserve its non-sensitive aggregate query objects or explicitly rebind/remount their observers. Always purge private account queries and mutations; retaining public totals does not permit retaining identity-owned data.

**Why:** React Query's full cache clear removed the public community-count Query object while its mounted observer still referred to that old object. Later authoritative cache writes and fresh network responses updated a new Query object, leaving the page displaying the old total. Fixing just the button was insufficient because the Firebase auth listener also cleared the cache.

**How to apply:** Audit the whole auth-change chain, including provider callbacks and sign-out, rather than only the initiating button. Test a mounted observer receiving the new value and cancellation of an old in-flight response, not just the server's count or cache contents.