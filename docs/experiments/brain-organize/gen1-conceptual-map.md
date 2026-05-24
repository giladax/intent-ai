# Experiment: Gen 1 — Conceptual Map

## Phase
Phase 4 — Chr 1 (Instructions) variation

## Hypothesis
Adding a `conceptualMap` field that forces the LLM to reason about project structure before assigning will produce hierarchy. If the LLM thinks about groupings first, it will use them.

## Configuration

### Locked Chromosomes
| Chromosome | Allele | Rationale |
|-----------|--------|-----------|
| Chr 2 (Format) | Same as baseline | Unchanged |
| Chr 3 (Synthesis) | None | No pre-computation |
| Chr 4 (Data Selection) | Same as baseline | Unchanged |

### Varied
| Allele | Description |
|--------|-------------|
| 1b-conceptual-map | Added `conceptualMap` array to schema. Prompt asks LLM to "understand the project first, find natural groups, build a tree that tells the story" |

## Results

### Output Tree
```
API Endpoints (6 insights, 3 sessions)
Brain Markdown Generation (7 insights, 3 sessions)
Brain Versioning (6 insights, 3 sessions)
Dashboard Architecture (7 insights, 3 sessions)
Design Principles (3 insights, 3 sessions)
Moment Detection (6 insights, 3 sessions)
Pipeline Orchestration (8 insights, 3 sessions)
Tech Stack (6 insights, 3 sessions)
```

### Metrics
- Root nodes: 8
- Children: 0
- Max depth: 1
- Tree tells a story: NO — even flatter than baseline

### Observations
- WORSE than baseline. The LLM filled `conceptualMap` with a correct tree (it understood groupings) but did NOT set `parentSpec` on assignments.
- The LLM SPLIT topics further — "Repo Brain pipeline" became three separate topics (Brain Versioning, Brain Markdown Generation, + others).
- Reasoning about structure in one output field doesn't transfer to another field. The connection between conceptualMap and assignments is implicit — the LLM doesn't enforce it.

### Root Cause
Chr 1 (Instructions) mutation when the real problem is Chr 3 (Synthesis). Asking the LLM to reason ≠ giving it pre-computed similarity signals. The mutation-selection playbook says: fix data/synthesis first, instructions last.

## Decision
- [x] Reject — worse than baseline, wrong chromosome targeted
