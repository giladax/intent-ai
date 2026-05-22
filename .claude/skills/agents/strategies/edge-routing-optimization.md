# Edge Routing Optimization

## Purpose

Optimize graph transitions and execution flow.

Routing instability is a major source of operational failures.

## Current Status

Edge routing is NOT yet implemented in the intent-ai pipeline. The current topology is linear with parallel fan-out. Pre-computation (accurate exchange labels via Haiku) may reduce or eliminate the need for conditional routing — test this hypothesis before adding routing complexity.

## Principles

- prefer deterministic routing
- bound every loop
- minimize branching depth
- log all routing decisions

## Routing Signals

Good routing inputs:
- explicit state flags
- pre-computed classifications (e.g., session shape, exchange engagement level)
- evaluator outputs
- schema validation results
- tool execution results

Bad routing inputs:
- vague reasoning text
- large conversation summaries
- unstable confidence scores
- regex-based classifications

## Anti-Patterns

Avoid:
- recursive routing without budgets
- topology-wide retries
- hidden conditional behavior
- overlapping routing conditions
- adding routing before proving that a single path with good pre-computation cannot handle the variance

## Routing Goals

Maximize:
- predictability
- debuggability
- evaluator clarity

Minimize:
- oscillation
- branching ambiguity
- retry explosion
