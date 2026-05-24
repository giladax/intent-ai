# Experiment: Organize Prompt Evolution

## Hypothesis
The organize prompt (Node 2) produces flat, story-less topic trees because it jumps to structural decisions without first understanding how new knowledge relates to existing nodes.

## Method
Same 3 sessions, same fragments. Change the organize approach. Compare topic trees.

---

## Gen 0: Baseline (current prompt)

**Prompt approach:** Rules-based filing clerk. "Max depth 3, prefer 3-7 roots, merge when >70% file overlap."

**Output:**
```
dashboard redesign (12 insights, 3 sessions)
digestion pipeline (21 insights, 3 sessions)
moment detection system (11 insights, 3 sessions)
Repo Brain pipeline (15 insights, 3 sessions)
tech stack and architecture decisions (10 insights, 3 sessions)
  └── v2 roadmap and strategy (5 insights, 3 sessions)
data model and schema (3 insights, 1 session)
```

**Diagnosis:** 6 roots, 1 child. Flat. No story.

---

## Gen 1: "Understand the project first" (conceptualMap)

**Prompt change:** Added `conceptualMap` field — ask LLM to reason about project structure before assigning.

**Output:**
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

**Diagnosis:** WORSE. 8 roots, zero nesting. LLM filled conceptualMap correctly but didn't translate it into parentSpec values. Reasoning about structure in one field doesn't mechanically connect to the output.

**Learning:** Asking the LLM to reason about structure ≠ making it USE that structure.

---

## Gen 2: Aborted prompt-level experiments

Three parallel experiments (two-pass, forced schema, few-shot) were started but paused. The insight: the problem is architectural, not prompt-level.

**Root cause:** The organize step does TWO things simultaneously:
1. Relate new knowledge to existing nodes (similarity/proximity)
2. Decide structural changes (merge/split/rename/add/remove/reparent)

Without step 1, step 2 has no grounding. The LLM doesn't know which nodes are similar, so it can't group them.

---

## Gen 3: Two-Step Organize (Relate → Decide)

**Hypothesis:** Split organize into two explicit steps:

### Step 1: Relate (Haiku, per-fragment)
For each fragment, find which existing specs it's closest to.
Output: `{ fragmentIndex, relatedSpecs: [{ spec, relevance: "high" | "partial" | "none" }] }[]`

This is KNN — the LLM acts as the distance function, computing proximity between new knowledge and existing nodes.

### Step 2: Decide (Haiku, full graph)
Given the similarity map + existing graph, decide mutations:
- `add` — new node (with parent)
- `merge` — combine similar nodes
- `split` — decompose broad node
- `rename` — better name for clarity
- `remove` — stale/orphaned node
- `reparent` — move to better parent

The similarity map GROUNDS the structural decisions. "Fragment 3 is HIGH relevance to both 'Pipeline Orchestration' and 'Moment Detection'" → the LLM can reason about whether those should be merged or parent-child.

**Expected improvement:** Hierarchy emerges from similarity, not from rules.
