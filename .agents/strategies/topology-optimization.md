# Topology Optimization

## Purpose

Select graph structures based on failure modes and workload shape.

Do not add topology complexity without evidence.

## Selection Guidance

| Problem Shape | Preferred Topology |
|---|---|
| Deterministic workflow | single-node |
| Tool iteration | react |
| Long-horizon execution | plan-execute |
| Structured repair | verify-repair |
| Delegation | supervisor-worker |
| Reusable modules | subgraph |

## Rules

Prefer:
- the simplest topology that satisfies evaluations
- bounded execution
- explicit state transitions

Avoid:
- reflection for schema enforcement
- multi-agent systems for routing problems
- supervisor-worker for simple flows

## Escalation Path

single-node -> verify-repair -> planner -> supervisor-worker

Complexity should evolve incrementally.