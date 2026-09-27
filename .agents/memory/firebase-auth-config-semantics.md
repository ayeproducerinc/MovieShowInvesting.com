---
name: Firebase Auth config semantics
description: Interpreting Identity Toolkit Admin API email-link settings.
---

The Identity Toolkit Admin API can omit `signIn.email.passwordRequired` after it is set to false. An omitted field is not evidence that passwordless email sign-in is still disabled.

**Why:** A successful project configuration update initially appeared to fail under a strict false-value readback, while Firebase subsequently accepted an email-link request.

**How to apply:** When interpreting Firebase project settings during email-link troubleshooting, distinguish an explicit true (password required) from an omitted/default false value. Confirm capability rather than treating omission as an error.