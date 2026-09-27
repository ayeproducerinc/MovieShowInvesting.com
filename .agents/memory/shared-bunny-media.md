---
name: Shared Bunny media
description: Owner decision to reuse existing Bunny media resources across the two products.
---

Reuse The AYeList's existing Bunny Stream library and Storage Zone for Movie Show Investing during the MVP. Keep Movie Show Investing images within the owner-created `Movie Show Investing folder` inside that zone, and do not modify unrelated AYeList media. Do not create separate Bunny resources unless the owner requests stronger isolation.

**Why:** The owner already has working Bunny media storage for The AYeList and explicitly chose to reuse it rather than adding new infrastructure for this MVP.

**How to apply:** New image paths should remain under the dedicated folder; treat Stream library and zone credentials as shared across products, so uploads and cleanup must be narrowly scoped to the asset they create.