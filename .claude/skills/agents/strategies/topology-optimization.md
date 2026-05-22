# Topology Optimization

## Purpose

Select graph structures based on failure modes and workload shape.

Do not add topology complexity without evidence.

## Current Topology: Linear with Parallel Fan-out

```
parse → normalize → [analyze + classify + chunk] (parallel) → session-digest → moments (fan-out per chunk) → dedup → transitions → narrative
```

Key features:
- Parallel fan-out for chunk processing (moments detected per-chunk concurrently)
- Session digest computed BEFORE fan-out, injected into each parallel chunk
- Two-pass moment detection with deterministic dedup between passes
- Linear pipeline overall, parallelism only where chunks are independent

## Selection Guidance

| Problem Shape | Preferred Topology |
|---|---|
| Deterministic workflow | single-node |
| Tool iteration | react |
| Long-horizon execution | plan-execute |
| Structured repair | verify-repair |
| Delegation | supervisor-worker |
| Reusable modules | subgraph |
| Independent chunk processing | parallel fan-out with shared digest |

## Rules

Prefer:
- the simplest topology that satisfies evaluations
- bounded execution
- explicit state transitions
- pre-computation to reduce downstream complexity
- parallel fan-out where chunks are independent (with shared context via digest)

Avoid:
- reflection for schema enforcement
- multi-agent systems for routing problems
- supervisor-worker for simple flows
- routing complexity when pre-computation can eliminate the need for routing

## Key Learning: Pre-computation May Make Routing Unnecessary

When exchanges arrive with accurate pre-computed labels (engagement, intent, agency), the need for conditional routing diminishes. A node that receives well-labeled inputs can handle diverse exchange types with a single prompt, rather than routing to specialist prompts. Test whether routing actually improves eval scores before adding it.

## Escalation Path

single-node -> verify-repair -> planner -> supervisor-worker

Complexity should evolve incrementally, justified by eval evidence.
