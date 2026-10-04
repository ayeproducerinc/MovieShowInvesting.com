---
name: Firebase signup timestamp precision
description: Trusted signup metadata has second-level precision; account-newness checks must honor that precision.
---

Do not interpret Firebase Admin's creation-time string as millisecond-accurate evidence that an account predates a captured referral. Treat a creation time in the same UTC second as the capture as ambiguous and eligible on timing; older seconds remain ineligible.

**Why:** Firebase Admin converts its underlying timestamp to a whole-second UTC string. Comparing that against PostgreSQL's precise capture time can reject a genuinely new signup completed later in the same second. This is a precision allowance, not permission to add a general retroactive-referral window.

**How to apply:** Honor the trusted provider's actual timestamp precision when comparing signup against server-side capture. Keep full precision for Replit account timestamps, and retain self/duplicate-account and receipt-expiry checks.