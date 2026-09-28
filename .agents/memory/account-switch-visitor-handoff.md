---
name: Account-switch visitor handoff
description: Authentication switches that preserve private ownership and browser popup activation.
---

When a browser switches authenticated accounts or identity providers, rotate an account-owned visitor cookie **while the old verified identity is still available**. Do not rotate an unclaimed guest cookie merely because a user is signing in. For Google popup account selection, any network-based visitor preparation must finish on a first explicit click; open the popup on a second click so it still has direct user activation.

**Why:** An old account's visitor cookie can make a new account's project or investor operations fail closed, even after query caches are cleared. Awaiting a server call before opening an OAuth popup may cause browsers to block it.

**How to apply:** Check both filmmaker and investor ownership when leaving an account; fail closed if safe preparation fails. When changing to a popup-based identity, separate cookie preparation and popup opening into distinct user actions, then revalidate the current identity before using prepared state.