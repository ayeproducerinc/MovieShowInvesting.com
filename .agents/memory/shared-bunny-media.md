---
name: Shared Bunny media
description: Owner decision to reuse existing Bunny media resources across the two products.
---

Reuse The AYeList's existing Bunny Stream library and Storage Zone for Movie Show Investing during the MVP. Put new trailers in the owner's existing Stream collection named `Movie Show Investing` (the owner referred to it as "movie show investing"), and keep images within the owner-created `Movie Show Investing folder` inside the Storage Zone. Do not modify unrelated AYeList media or move older videos. Do not create separate Bunny resources unless the owner requests stronger isolation.

**Why:** The owner already has working Bunny media storage for The AYeList and explicitly chose to reuse it rather than adding new infrastructure for this MVP. They subsequently created a dedicated Stream collection and asked that new Movie Show Investing trailers use it.

**How to apply:** New Stream videos should be created with the configured collection ID; never silently fall back to the library root when it is missing. New image paths should remain under the dedicated folder. Treat Stream library and zone credentials as shared across products, so uploads and cleanup must be narrowly scoped to the asset they create.