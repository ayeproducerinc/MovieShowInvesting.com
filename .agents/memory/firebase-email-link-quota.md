---
name: Firebase email-link quota
description: Project-wide email-link sending limit and safe recovery choices.
---

Firebase can return `auth/quota-exceeded` when sending a passwordless sign-in email even though the email provider, web app configuration, and authorized domain are valid. The current Firebase Authentication limits documentation lists 5 email-link sign-in emails/day on Spark and 25,000/day on Blaze; do not assume this project's billing tier without checking it.

**Why:** Repeated sign-in attempts cannot fix a project-wide sending quota. The login UI previously masked the Firebase error as an address problem, leading to more retries.

**How to apply:** Surface the exact safe error code and explain the daily sending limit. Offer waiting for the quota reset or having the owner choose billing (which may incur charges). An alternative transactional sender for Admin-generated email links is a separate, owner-approved integration; never display a generated sign-in link or issue a custom token to bypass proof of email ownership. Check current limits at https://firebase.google.com/docs/auth/limits before quoting them.