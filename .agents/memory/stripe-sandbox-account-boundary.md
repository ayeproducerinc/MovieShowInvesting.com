---
name: Stripe sandbox account boundary
description: Why the pitch-review test checkout uses the app-connected sandbox rather than the earlier MCP-listed sandbox
---

For pitch-review testing, use the sandbox account attached to the application connector, not a payment link created in a different Stripe sandbox. The owner explicitly chose the connected Movie Show Investing Sandbox after an account mismatch was found with The AYeList sandbox.

**Why:** Checkout sessions and payments created in one Stripe account cannot be verified through credentials for another account. A standalone payment link in the other sandbox would collect test payments without reliably queuing the matching pitch.

**How to apply:** When changing payment mode or account, verify that checkout creation and server-side reconciliation target the same account before sharing a link. Do not treat MCP account access as proof that the running app uses that account.

Application environment and connector credential selection are independent. A development workflow can receive the live account through the existing connector. Reject that mismatch; do not weaken the account guard or replace a working live connection merely to complete a sandbox test.

**Why:** Selecting development mode changes the application's expected account, not the external account returned by the connector.

**How to apply:** Read-only account verification should precede sandbox checkout. If the approved live account is returned instead, preserve live access and obtain owner-approved sandbox access separately.