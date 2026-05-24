# Experiment: Gen 3 — Relate-Then-Decide (KNN + Reinforcement)

## Phase
Phase 2 — Chr 3 (Synthesis) variation

## Hypothesis
The organize node fails because it lacks similarity pre-computation. Splitting into **Relate** (compute proximity) → **Decide** (structural mutations) fixes this. But a single Relate call doing many-to-many is too much — decompose further using patterns from the agent skills.

## Architecture: Incremental Reinforcement Graph

Each session adds a **small delta** to the graph. Structure emerges from accumulated signal, not one-shot reasoning.

### The Pipeline

```
Session ingestion
  ↓
PreComputeSessionDigest (deterministic, once per session)
  - topic flow: ordered concept mentions across fragments
  - shared concepts: keywords appearing in multiple fragments
  - fragment boundaries: transitions between topics within session
  ↓
FilterCandidates (deterministic, per fragment)
  - file path overlap with existing topics
  - keyword overlap from digest
  - return top-5 candidate topics (not all 100)
  ↓
RelateFragment (Haiku × N fragments, parallel)
  - input: fragment + session digest + top-5 candidates
  - question: "Which of these candidates does this fragment connect to?"
  - output: edges { topicId, relevance: high|partial|none, reasoning }
  - also: newTopicSignal { needed: boolean, nameHint, reasoning }
  ↓
VerifyEdges (deterministic, batch)
  - schema validity
  - collision detection (new topic doesn't duplicate existing)
  - confidence grounding
  ↓
RepairEdges (Haiku, only on failures — ~10% of edges)
  ↓
AccumulateSignal (deterministic)
  - store edges in topic_relations with strength scores
  - topics co-occurring in same fragment proximity → implicit connection
  - over many sessions: strong connections = parent-child or merge candidates
  ↓
Decide (Haiku × 1, uses Gen2B level schema)
  - input: accumulated signals + existing graph + new edges
  - output: GraphPlan with level: root|child on every assignment
  - mutations: add, merge, split, rename, remove, reparent
```

### Why This Works (Agent Skills Patterns Applied)

**From context-composition:** Pre-compute session digest BEFORE fan-out. Each relate worker gets digest + top-5 candidates, not the full graph. Cost: $0 (deterministic).

**From node-contract-optimization:** Each node answers ONE question:
- Relate: "Which existing topics does this fragment connect to?"
- Verify: "Are these edges valid?" (deterministic, no LLM)
- Decide: "Given accumulated signal, what mutations produce the best tree?"

**From mutation-selection:** Fix synthesis (Chr 3) before instructions (Chr 1). Pre-computation does the heavy lifting. When inputs are well-labeled, even simple prompts work.

**From verify-repair:** Relate can be permissive (catch most cases). Verify is deterministic (cheap). Repair only runs when needed. Don't use reflection — use explicit verification criteria.

**From complexity-budget:** Every +2 complexity needs +1 eval lift:
- Session digest: +1 cost → +2 confidence (good ROI)
- Candidate pre-filtering: +1 cost → +1 speed (good ROI)
- Verify-repair: +3 cost → prevents bad edges (justified when >5% failure rate)
- Evaluator-optimizer for restructuring: only when signals warrant it

### Reinforcement Model

The key insight: **don't reorganize the tree every session.** Instead:

1. **Per session:** Relate fragments, accumulate edges. Fast, cheap.
2. **Per N sessions (or on trigger):** Decide structural changes. Uses accumulated signal.
3. **Triggers for restructuring:**
   - >50% of fragments create new topics (tree too shallow)
   - >3 fragments per session clash on parent assignment (ambiguous boundaries)
   - File overlap between topics exceeds threshold (merge candidates)

### Cost Per Session (5 fragments)

| Step | Calls | Model | Cost |
|------|-------|-------|------|
| PreComputeSessionDigest | 0 | deterministic | $0.00 |
| FilterCandidates | 0 | deterministic | $0.00 |
| RelateFragment (5×) | 5 | Haiku | ~$0.005 |
| VerifyEdges | 0 | deterministic | $0.00 |
| RepairEdges (~10%) | 0.5 | Haiku | ~$0.0005 |
| Decide | 1 | Haiku | ~$0.001 |
| **Total** | ~7 | — | **~$0.007** |

### What Changes from Current Architecture

**Current:** Extract (Sonnet) → Organize (Haiku × 1, does everything) → Write (Sonnet)

**New:** Extract (Sonnet) → PreCompute (deterministic) → Filter (deterministic) → Relate (Haiku × N, parallel) → Verify (deterministic) → Decide (Haiku × 1, with accumulated signal + Gen2B level schema) → Write (Sonnet)

**Net change:** +N Haiku calls for relating, but each is tiny (one fragment + 5 candidates). The Decide step receives grounded proximity data instead of raw fragments. Gen2B's level schema forces hierarchy in the output.

## Configuration

### Locked Chromosomes
| Chromosome | Allele | Rationale |
|-----------|--------|-----------|
| Chr 1 (Instructions) | Gen2B level schema for Decide step | Winner from Gen 2 experiments |
| Chr 2 (Format) | Structured JSON with level field | Gen2B format |
| Chr 4 (Data Selection) | Same fragments from extract step | Unchanged |

### Varied
| Allele | Description |
|--------|-------------|
| 3c-relate-accumulate | Pre-compute session digest + filter candidates + per-fragment relate with Haiku, feeding accumulated signal to Decide step |

## Results
_Not yet run_

## Decision
- [ ] Pending

## New Files Needed
- `src/pipeline/brain-relate.ts` — PreCompute + Filter + Relate + Verify
- `src/llm/prompts/brain-relate.ts` — Relate prompt (per-fragment, narrow)
- Modify `src/pipeline/brain-synthesis.ts` — Wire relate → decide in synthesizeV2
- Modify `src/llm/prompts/brain-organize.ts` — Decide step receives RelateMap + uses Gen2B level schema
