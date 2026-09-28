---
name: Drizzle existing checks
description: A development schema push may not apply changes to an existing PostgreSQL check constraint.
---

After changing an existing Drizzle CHECK expression, verify the live development constraint definition rather than relying on a successful push message. If the old definition remains, apply only the intended constraint replacement in development and verify it afterward; do not add startup or deploy-time DDL or write directly to managed production.

**Why:** A development push reported success while leaving a modified CHECK constraint at its old definition, so the application and database disagreed about a valid input range.

**How to apply:** Compare PostgreSQL's constraint definition with the schema source for CHECK edits. Keep the schema source aligned with the actual development database so the supported publish-time schema diff can apply it to managed production.