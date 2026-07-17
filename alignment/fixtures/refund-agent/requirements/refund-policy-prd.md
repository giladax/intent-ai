---
reference: refund-policy-prd
title: Refund Agent Policy PRD
version: "3"
status: approved
approved_by: product-council
approved_on: 2026-06-20
---

# Refund Agent Policy — PRD v3 (approved)

## Scope

Automatic refund handling by the production refund agent.

## Approved behavior

### Premium refunds {#premium-refunds}

Premium-tier customers with a low risk score may receive automatic refunds
up to **$100** without human involvement. This supersedes the previous $50
limit approved in v2.

### High-risk handling {#high-risk}

Refund requests flagged high-risk **always** require human approval,
regardless of tier or amount. The agent must never execute a high-risk
refund automatically.

### Enforcement ceiling {#enforcement}

No automatic refund above the approved premium limit may ever be executed.
The tool-side guard must enforce a hard ceiling independently of the
decision policy, so that a refund above the approved premium limit can
never execute even if the decision policy would approve it.

### Standard tier {#standard-tier}

Standard-tier customers may receive automatic refunds up to **$25**.

### Auditability {#audit}

Every refund decision — approved, denied, or escalated — must emit an audit
event containing the decision rationale.

### Escalation prompt {#escalation-prompt}

The agent's operating prompt must instruct it to escalate high-risk requests
to a human operator.
