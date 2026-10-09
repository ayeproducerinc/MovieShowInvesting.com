---
name: Firebase-only authentication
description: Sign-in is Google via Firebase only; Replit login, sessions and the replit-auth-web package were removed
---

The only sign-in is Google through Firebase. The browser attaches a Firebase ID token as `Authorization: Bearer`, and the API verifies it with `firebase-admin` (`artifacts/api-server/src/lib/filmmaker-auth.ts`). Admin access is `ADMIN_EMAIL` plus its canonical Firebase UID.

**Why:** The owner never used Replit login and asked for it to be removed entirely. The Replit layer gated the Firebase token on Replit state: a leftover `msi_replit_auth_active` marker silently dropped the Bearer token, and focus re-checks unmounted auth-gated pages.

**How to apply:**
- Don't reintroduce `@workspace/replit-auth-web`, a session cookie, `/api/auth/user`, `/api/login` or `/api/logout`, or any `replitAuth`/`isReplitAuth*` gate. Install the Firebase token getter whenever a Firebase user exists.
- `REPLIT_DOMAINS`/`AUTH_PUBLIC_ORIGIN` still matter: they describe the site's domain for the same-origin check (`lib/trusted-origin.ts`) and the Stripe return URL. They are not login.
- `replit_uid` columns, the `replit_auth_users`/`sessions` tables and stored-row guards (`replit_uid IS NULL`) intentionally remain. Never drop them via `drizzle-kit push`; that needs a reviewed SQL migration.
