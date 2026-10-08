---
name: Esbuild module identity
description: Plugin-resolved paths can create duplicate stateful module instances
---

Canonicalize absolute paths returned by esbuild resolution plugins. Repeated slashes in a plugin path can produce a second module instance even when a normal relative import refers to the same physical file.

**Why:** Isolated checkout tests initialized one copy of a shared fixture while aliased dependencies used a different copy, leaving their state undefined.

**How to apply:** When bundling tests with stateful aliases, resolve fixture paths consistently rather than relying on the filesystem to normalize equivalent path strings.
