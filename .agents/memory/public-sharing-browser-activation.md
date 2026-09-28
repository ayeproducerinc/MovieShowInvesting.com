---
name: Public sharing and browser activation
description: Balance privacy-safe public project sharing with browser user-activation requirements.
---

Keep private investor records out of shared links. Select only an eligible public project from fresh background data, and rely on the server's eligibility gate so a project hidden later will no longer resolve to public content. Do not await an eligibility network request inside a share or copy click handler before calling native share or clipboard APIs.

**Why:** Browsers may require a live user gesture for native sharing and clipboard writes. An awaited network request can consume that activation and cause the user-visible action to fail even if the eligibility check succeeds. The server must independently enforce public visibility at link resolution.

**How to apply:** On investor share actions, refresh eligible choices on mount, window focus, and a short interval; disable actions while refreshing or on errors. Invoke the browser API promptly in the click handler. Keep private identity, allocations, and signed amount out of the share payload.