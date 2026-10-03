---
name: Firebase runtime web configuration
description: Use the app's effective browser configuration for authentication tests rather than assuming an existing environment key is active.
---

Authentication test clients should use the app's effective public Firebase web configuration and verify internally that its project matches the Admin SDK project. The presence of a configured Firebase API-key secret does not establish that it is the key the running app uses.

**Why:** A custom-token test exchange failed with the environment key even though the Admin SDK and app used the same project. The app's effective public web-config key succeeded. The app itself did not need an authentication configuration change.

**How to apply:** Resolve the existing runtime web-config endpoint for test clients. Compare project identifiers internally without printing keys or tokens. Do not replace working app credentials just to fix an ad hoc test harness.

## Authentication test execution boundary

The browser notebook and workspace shell may have different localhost networks. A shell-local token bridge is not necessarily reachable by the browser tester.

**Why:** Signed-in browser verification was blocked by this separation, while a temporary verified Firebase identity and authenticated API checks succeeded within one shell process, with credentials and tokens kept in memory.

**How to apply:** Never weaken authentication or put test tokens in public artifacts to bypass the separation. If safe browser authentication is unavailable, validate the backend separately and explicitly disclose that protected browser interactions remain unverified.