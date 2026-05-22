# Complexity Budget

## Purpose

Treat graph complexity as an operational cost.

Every added node, edge, loop, verifier, or agent increases:
- debugging difficulty
- evaluator ambiguity
- operational risk
- state complexity
- regression probability

## Suggested Cost Model

| Component | Cost |
|---|---|
| New node | +1 |
| New edge | +1 |
| Conditional routing | +2 |
| Retry loop | +3 |
| Verifier node | +3 |
| Reflection loop | +7 |
| Additional tool | +2 |
| Cross-graph communication | +8 |
| Multi-agent supervisor | +10 |

## Required Justification

Every complexity increase must define:
- expected evaluation lift
- operational impact
- observability impact
- rollback strategy
- regression risk

## Budget Rule

Prefer:
- deterministic systems
- bounded workflows
- explicit routing
- verification over reflection

Complexity should be earned through evaluation evidence.