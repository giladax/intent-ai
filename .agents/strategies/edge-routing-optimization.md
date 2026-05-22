# Edge Routing Optimization

## Purpose

Optimize graph transitions and execution flow.

Routing instability is a major source of operational failures.

## Principles

- prefer deterministic routing
- bound every loop
- minimize branching depth
- log all routing decisions

## Routing Signals

Good routing inputs:
- explicit state flags
- evaluator outputs
- schema validation results
- tool execution results

Bad routing inputs:
- vague reasoning text
- large conversation summaries
- unstable confidence scores

## Anti-Patterns

Avoid:
- recursive routing without budgets
- topology-wide retries
- hidden conditional behavior
- overlapping routing conditions

## Routing Goals

Maximize:
- predictability
- debuggability
- evaluator clarity

Minimize:
- oscillation
- branching ambiguity
- retry explosion