---
name: Mixed-provider thread access
description: PostgreSQL NULL semantics in authorization for private investor–filmmaker conversations across sign-in providers.
---

In a private conversation, each participant may belong to a different sign-in provider. Match the requester against their own provider-qualified UID, while treating the other participant's UID in that provider column as nullable. Any exclusion of accounts occupying both roles must be NULL-safe.

**Why:** In PostgreSQL, `NOT (investor_uid = uid AND filmmaker_uid = uid)` does not become true when the other provider's UID is NULL; it evaluates to unknown and can silently hide a legitimate mixed-provider conversation.

**How to apply:** Review list, detail, reporting, and messaging authorization as a whole whenever the role/identity query changes. Use NULL-safe comparisons for both-role exclusions and determine the sender's role from the matched participant rather than requiring the account to have only one role globally.