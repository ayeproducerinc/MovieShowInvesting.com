---
name: Question email delivery uncertainty
description: Why private answers cannot be retried automatically after an ambiguous Mailjet outcome
---

For the private filmmaker question relay, reserve answer delivery durably before sending the email. If the provider outcome or the database finalization is uncertain, leave the answer closed to automatic retries and require deliberate reconciliation rather than risk sending the asker a duplicate reply.

**Why:** An email provider can accept a message while the HTTP request times out, or the database can fail after the provider accepts it. Retrying either case as if delivery definitely failed may email the same private answer twice.

**How to apply:** When changing the answer flow or provider handling, distinguish a confirmed no-send from an ambiguous failure. Only reopen automatic retry after a confirmed no-send; preserve a way to review uncertain deliveries manually.