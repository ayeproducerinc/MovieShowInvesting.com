---
name: Firebase email-link handoff
description: Browser-context constraints for email-link completion and one-time continuation.
---

Keep admin sign-in in the existing app tab. Automatic email-link completion is appropriate when the return link can read the pending email saved on the same site in the same browser context. A link opened elsewhere must still ask for the recipient address; do not put that address into the continuation URL to bypass the check.

**Why:** The owner explicitly does not want the app to open or require an extra tab when an admin tab is already open. Embedded previews can have storage partitioned differently from the tab an email app opens, but forcing a second app tab is not an acceptable workaround. Firebase requires the address when completing an email-link sign-in to guard against session injection. The app cannot control whether the email client itself opens a new tab.

**How to apply:** Keep the sign-in form in the current admin tab, let an already-saved address complete automatically, and let that tab update when the browser shares authentication state. Retain the manual-address fallback for separate browsers or storage partitions. Do not claim cross-browser automatic sign-in without designing a secure alternative.

For a filmmaker action that continues after sign-in, allow only one browser-origin tab to execute a draft-creating action. Firebase authentication can update both the waiting tab and the email-link tab at once.

**Why:** If both tabs claim the visitor and start simultaneously, they may race shared cookies and edit the same new draft. A duplicate action risks overwriting saved answers.

**How to apply:** Coordinate claim and continuation across same-origin tabs, consume the pending action once, and fall back to a manual desk action when coordination is unavailable. A link opened in another browser still cannot claim a guest project without its original-browser proof.