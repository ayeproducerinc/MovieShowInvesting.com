---
name: Manual frontend build environment
description: Why a shell-invoked frontend build needs explicit environment values in this workspace
---

Manual shell builds do not automatically receive the environment values supplied to managed artifact workflows. A missing build-time port or base path in an ad hoc shell run does not mean the production publishing setup is broken.

**Why:** An otherwise valid frontend change passed type checking but the first two shell builds stopped while loading Vite's config; supplying the managed build-time requirements allowed the same code to build.

**How to apply:** For a manual frontend build, provide a valid port and the artifact's path base in that shell invocation. Do not weaken Vite's configuration or treat a missing shell environment value as evidence that the app code failed.