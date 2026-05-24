# Experiment: Gen 0 — Baseline Organize

## Phase
Phase 0 — Baseline measurement

## Hypothesis
Current single-call organize prompt will produce a flat tree because it lacks similarity pre-computation and has no concept of "closeness" between topics.

## Configuration

### Locked Chromosomes
| Chromosome | Allele | Rationale |
|-----------|--------|-----------|
| Chr 1 (Instructions) | Rules-based: "max depth 3, prefer 3-7 roots, merge >70% file overlap" | Default |
| Chr 2 (Format) | Specs as markdown sections with file lists | Default |
| Chr 3 (Synthesis) | None — no pre-computation of similarity | Default |
| Chr 4 (Data Selection) | Existing specs + fragments + shared file ratios | Default |

### Varied
Baseline — nothing varied.

## Results

### Output Tree
```
dashboard redesign (12 insights, 3 sessions)
digestion pipeline (21 insights, 3 sessions)
moment detection system (11 insights, 3 sessions)
Repo Brain pipeline (15 insights, 3 sessions)
tech stack and architecture decisions (10 insights, 3 sessions)
  └── v2 roadmap and strategy (5 insights, 3 sessions)
data model and schema (3 insights, 1 session)
```

### Metrics
- Root nodes: 6
- Children: 1 (v2 roadmap under tech stack)
- Max depth: 2
- Tree tells a story: NO — flat list of silos

### Observations
- Moment detection is separate from digestion pipeline (should be a child)
- Brain pipeline is separate from dashboard (no Developer Experience grouping)
- "data model and schema" is orphaned with 1 session — should merge or nest
- No conceptual grouping whatsoever

## Decision
- [x] Reject — flat tree, no story
