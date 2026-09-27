---
name: Firebase email-link handoff
description: Browser-context constraints for automatic admin email-link completion.
---

Keep admin sign-in in the existing app tab. Automatic email-link completion is appropriate when the return link can read the pending email saved on the same site in the same browser context. A link opened elsewhere must still ask for the recipient address; do not put that address into the continuation URL to bypass the check.

**Why:** The owner explicitly does not want the app to open or require an extra tab when an admin tab is already open. Embedded previews can have storage partitioned differently from the tab an email app opens, but forcing a second app tab is not an acceptable workaround. Firebase requires the address when completing an email-link sign-in to guard against session injection. The app cannot control whether the email client itself opens a new tab.

**How to apply:** Keep the sign-in form in the current admin tab, let an already-saved address complete automatically, and let that tab update when the browser shares authentication state. Retain the manual-address fallback for separate browsers or storage partitions. Do not claim cross-browser automatic sign-in without designing a secure alternative.