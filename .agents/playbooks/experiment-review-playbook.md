# Experiment Review Playbook

## Purpose

Review graph mutations using structured evaluation evidence instead of intuition.

LangSmith experiments should be treated as software change reviews, not prompt demos.

## Review Workflow

### 1. Validate Experiment Metadata

Every experiment must define:
- hypothesis
- graph version
- evaluator version
- dataset version
- mutation scope
- rollback condition

Reject experiments with undefined mutation boundaries.

### 2. Inspect Aggregate Metrics

Review:
- task success
- evaluator scores
- latency
- token cost
- retry frequency
- routing accuracy

Avoid optimizing a single metric in isolation.

### 3. Inspect Regression Cases

Focus on:
- new failure classes
- evaluator disagreements
- routing instability
- schema violations
- hallucination increases

A successful experiment may still be rejected if regressions are operationally dangerous.

### 4. Review Traces

Inspect:
- state growth
- unnecessary reasoning
- retry loops
- tool misuse
- verifier behavior
- edge oscillation

Trace review is mandatory for topology mutations.

### 5. Decision

Allowed outcomes:
- Promote
- Reject
- Needs isolation
- Requires additional datasets

## Promotion Standard

Promote only if:
- improvements are statistically meaningful
- complexity increase is justified
- observability remains understandable
- regressions are acceptable