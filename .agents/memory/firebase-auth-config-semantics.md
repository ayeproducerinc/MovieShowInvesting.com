---
name: Firebase Auth config semantics
description: Interpreting Identity Toolkit Admin API email-link settings.
---

The Identity Toolkit Admin API can omit `signIn.email.passwordRequired` after it is set to false. An omitted field is not evidence that passwordless email sign-in is still disabled.

**Why:** A successful project configuration update initially appeared to fail under a strict false-value readback, while Firebase subsequently accepted an email-link request.

**How to apply:** When interpreting Firebase project settings during email-link troubleshooting, distinguish an explicit true (password required) from an omitted/default false value. Confirm capability rather than treating omission as an error.

Firebase browser initialization alone does not prove that web configuration belongs to the project used by the Admin SDK. An apparently healthy bootstrap can still fail when the first email-link request is made.

**Why:** Independent web configuration values disagreed with the service-account project, and the failure appeared only when sending a sign-in link. The owner confirmed a real admin sign-in after configuration was aligned and the provider/domain settings were enabled.

**How to apply:** Treat Firebase initialization as a bootstrap check, not an authentication gate. For future authentication work, verify that browser and server refer to the same project and require a real sign-in result before declaring the flow working.