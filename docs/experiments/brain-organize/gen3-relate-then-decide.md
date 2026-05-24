# Experiment: Gen 3 — Relate Then Decide (KNN-inspired)

## Phase
Phase 2 — Chr 3 (Synthesis) variation

## Hypothesis
The organize node fails because it lacks similarity pre-computation. It jumps to structural decisions without knowing which nodes are semantically close. Adding a **relate** step — where each fragment's proximity to existing specs is computed BEFORE the organize call — gives the LLM the grounding it needs to produce hierarchy.

This follows the mutation-selection playbook: fix synthesis (Chr 3) before instructions (Chr 1). The intent-ai experiments showed pre-computation does the heavy lifting (3c won at 4.80/5).

## Architecture

### KNN-Inspired Two-Step Organize

```
Step 1: Relate (Haiku × 1 call)
  Input: all fragments + all existing specs
  Question: "For each fragment, which existing specs is it closest to?"
  Output: RelateMap — fragment → [{ spec, relevance: high|partial|none, reasoning }]

  This IS the distance function. Haiku computes semantic proximity.

Step 2: Decide (Haiku × 1 call)
  Input: RelateMap + existing specs + signals
  Question: "Given these proximity relationships, what graph mutations produce the best tree?"
  Output: GraphPlan with mutations: add, merge, split, rename, remove, reparent

  This uses the distances to make structural decisions.
```

### Why KNN is the right mental model

KNN says: "to classify a new point, look at its K nearest neighbors."

Our version: "to place a new fragment, look at which existing specs it's semantically closest to." If fragment F is closest to specs A and B, and A and B are also close to each other — maybe A and B should be merged, or one should be a child of the other. The proximity map reveals the clustering structure that the LLM can then reason about.

### What changes from current architecture

Current: Node 2 is a single Haiku call that does relate + decide simultaneously.
New: Node 2 becomes two Haiku calls in sequence.
- Call 1 (Relate): cheap, focused, produces structured similarity data
- Call 2 (Decide): receives similarity data AS INPUT, makes structural decisions grounded in it

Cost: +1 Haiku call (~$0.001). Negligible.

## Configuration

### Locked Chromosomes
| Chromosome | Allele | Rationale |
|-----------|--------|-----------|
| Chr 1 (Instructions) | Clean prompt for each step | Adapted to new topology |
| Chr 2 (Format) | RelateMap as structured input to Decide | New format |
| Chr 4 (Data Selection) | Same as baseline | Unchanged |

### Varied
| Allele | Description |
|--------|-------------|
| 3b-relate-map | Pre-compute similarity between fragments and existing specs via Haiku call before the organize decision |

## Results
_Not yet run_

## Decision
- [ ] Pending

## Notes
This is the highest-confidence experiment. It addresses the root cause (missing synthesis) rather than symptoms (flat output). The mutation-selection playbook consistently shows Chr 3 mutations have the biggest impact.

New files needed:
- `src/llm/prompts/brain-relate.ts` — Relate step prompt + schema
- Modify `src/llm/prompts/brain-organize.ts` — Decide step receives RelateMap
- Modify `src/pipeline/brain-synthesis.ts` — Wire relate → decide sequence
