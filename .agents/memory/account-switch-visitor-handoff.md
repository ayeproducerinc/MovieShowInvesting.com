---
name: Account-switch visitor handoff
description: Authentication switches that preserve private ownership and browser popup activation.
---

When a browser switches authenticated accounts or identity providers, rotate an account-owned visitor cookie **while the old verified identity is still available**. Do not rotate an unclaimed guest cookie merely because a user is signing in. For Google popup account selection, any network-based visitor preparation must finish on a first explicit click; open the popup on a second click so it still has direct user activation. Linked investor worksheet answers need the same exact verified-owner checks for reads and writes; a visitor cookie alone is not proof after account linking. If an unfinished guest worksheet and an account worksheet coexist, reject a silent handoff rather than replacing either set of answers.

**Why:** An old account's visitor cookie can make a new account's project or investor operations fail closed, even after query caches are cleared. A cookie-only investor progress read could expose private answers to a later user of that browser, while silently preferring an account draft could hide an unfinished guest draft. Awaiting a server call before opening an OAuth popup may cause browsers to block it.

**How to apply:** Check both filmmaker and investor ownership when leaving an account and before reading or saving linked progress; fail closed if safe preparation fails. Preserve an unclaimed guest draft when it conflicts with an account draft and require an explicit resolution. When changing to a popup-based identity, separate cookie preparation and popup opening into distinct user actions, then revalidate the current identity before using prepared state.