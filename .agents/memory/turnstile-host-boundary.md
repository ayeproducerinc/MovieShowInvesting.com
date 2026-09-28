---
name: Turnstile hostname boundary
description: Why anti-bot challenge hostnames must be checked against trusted app configuration.
---

For protected public forms, treat the Turnstile response hostname as valid only if it matches an app domain configured on the server. A request hostname or forwarded-host header is not an independent source of trust behind a reverse proxy. Keep the form unavailable when the permitted-host list is empty, even if a widget key exists.

**Why:** A caller may influence proxy-derived host headers; comparing a challenge with a caller-supplied host can validate a challenge issued for the wrong site. Merely checking Turnstile's success flag does not establish that its action and host match the intended form.

**How to apply:** For every new Turnstile-protected form, require an action-specific token and check both its action and response hostname against the server's permitted app domains before creating records or sending messages. Use genuine provider checks on the launch domain before declaring the form available.