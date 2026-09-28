---
name: Transactional email uncertainty
description: Why transactional email attempts cannot be retried automatically after an ambiguous Mailjet outcome
---

Reserve delivery durably before sending transactional mail, including private filmmaker question answers and confirmed-interest notifications. If the provider outcome or database finalization is uncertain, leave the attempt closed to automatic retries and require deliberate reconciliation rather than risk sending a duplicate.

**Why:** An email provider can accept a message while the HTTP request times out, or the database can fail after the provider accepts it. Retrying either case as if delivery definitely failed may email the same private answer twice.

**How to apply:** When changing a notification or answer flow, distinguish a confirmed no-send from an ambiguous failure. Only reopen automatic retry after a confirmed no-send; preserve a way to review uncertain deliveries manually. A single signing can affect multiple projects belonging to one account, but should send only one summary email to that account.