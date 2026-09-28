---
name: Legacy message sender identity
description: Preserve historical message provenance when tightening provider-specific attribution.
---

Do not retroactively assign a provider to historical message sender IDs that were stored without one. New sender identities should be provider-qualified, while the rolling message limit should conservatively include legacy records until they age out of its window.

**Why:** A raw historical ID cannot prove which identity provider supplied it. Guessing during a migration or export could attribute a private message to the wrong account; ignoring recent legacy messages could let an account evade the daily limit.

**How to apply:** When changing messaging storage, audits, exports, or rate limits, preserve the ambiguity of old records and use verified provider-specific participant ownership for new actions. Migrate historical attribution only if independent evidence can establish it safely.