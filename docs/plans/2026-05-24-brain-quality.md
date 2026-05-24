# Brain Quality Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace single-call brain synthesis with three-node pipeline (extract → organize → write) that produces hierarchical, spec-quality topics.

**Architecture:** Node 1 (Sonnet) extracts spec fragments per-session. Node 2 (Haiku) organizes the full graph into a tree. Node 3 (Sonnet) writes each changed spec as a living design doc. `applyGraphPlan` handles DB writes deterministically.

**Tech Stack:** TypeScript, Zod, Anthropic SDK (callSonnet/callHaiku), Postgres/Drizzle, Vitest

---

### Task 1: Schema Migration — add parent_topic_id

**Files:**
- Create: `drizzle/0004_brain_hierarchy.sql`
- Modify: `src/storage/schema.ts:255-262`
- Modify: `src/adapters/types.ts` (Topic interface)

**Step 1: Write migration**
```sql
ALTER TABLE topics ADD COLUMN parent_topic_id UUID REFERENCES topics(id) ON DELETE SET NULL;
```

**Step 2: Add parentTopicId to schema.ts topics table**

**Step 3: Add parentTopicId to Topic interface in types.ts**

**Step 4: Run migration**
Run: `npx tsx src/cli/index.ts up`

**Step 5: Commit**
```bash
git commit -m "feat(db): add parent_topic_id for hierarchical topics"
```

---

### Task 2: Node 1 — Extract prompt + schema

**Files:**
- Create: `src/llm/prompts/brain-extract.ts`
- Create: `tests/pipeline/brain-extract.test.ts`

**Step 1: Write failing test** — Zod schema parses well-formed SpecFragment JSON, handles defaults, wraps string evidence (mirror patterns from brain-synthesis.test.ts)

**Step 2: Run test, verify fail**

**Step 3: Implement** — `SpecFragmentSchema`, `SpecFragmentOutputSchema`, `buildBrainExtractPrompt(input)`. Same input type as current `BrainSynthesisInput` but output is `{ fragments: SpecFragment[] }` — no relatedTopics, no hierarchy. Prompt asks for "knowledge fragments" not "topics."

**Step 4: Run test, verify pass**

**Step 5: Commit**

---

### Task 3: Node 2 — Organize prompt + schema

**Files:**
- Create: `src/llm/prompts/brain-organize.ts`
- Create: `tests/pipeline/brain-organize.test.ts`

**Step 1: Write failing test** — Zod schema parses GraphPlan JSON with assignments, merges, splits arrays. Test defaults (empty arrays). Test lenient parsing.

**Step 2: Run test, verify fail**

**Step 3: Implement** — `GraphPlanSchema`, `buildBrainOrganizePrompt(existingSpecs, fragments, signals)`. Prompt constraints: max depth 3, prefer 3-7 roots, merge when high file overlap. Cold start handling (no existing specs).

Pre-compute `signals` deterministically before calling: per-topic file lists, session counts, shared file ratios between topic pairs, staleness (days since last update).

**Step 4: Run test, verify pass**

**Step 5: Commit**

---

### Task 4: Node 3 — Write prompt + schema

**Files:**
- Create: `src/llm/prompts/brain-write.ts`
- Create: `tests/pipeline/brain-write.test.ts`

**Step 1: Write failing test** — Zod schema parses final spec output (same shape as current TopicSchema but summary should be design-doc quality). Test that tree context (parent, children) is included in prompt.

**Step 2: Run test, verify fail**

**Step 3: Implement** — `buildBrainWritePrompt(spec, fragments, treeContext)`. Prompt instructs: "Write as a living design document. Describe what the system does, why, and how. Not a changelog." Include parent summary and child names as context.

**Step 4: Run test, verify pass**

**Step 5: Commit**

---

### Task 5: applyGraphPlan — deterministic DB operations

**Files:**
- Create: `src/pipeline/brain-apply.ts`
- Create: `tests/pipeline/brain-apply.test.ts`

**Step 1: Write failing tests** — test merge (insights moved, absorbed topic deleted, duplicate insights deduped), split (new topics created, insights reassigned by ID), create (parent_topic_id set), update (summary replaced). Test cycle detection rejects circular parents. Test name normalization.

**Step 2: Run tests, verify fail**

**Step 3: Implement** — `applyGraphPlan(repoId, sessionId, plan, writtenSpecs, momentIdMap)`. Execution order: merges → splits → creates → updates. Validate no circular parents before applying.

**Step 4: Run tests, verify pass**

**Step 5: Commit**

---

### Task 6: Wire pipeline — new orchestrator

**Files:**
- Modify: `src/pipeline/brain-synthesis.ts` — add `synthesizeV2` function (keep old `synthesizeFromSession` for now)
- Modify: `src/cli/index.ts:50-136` — `brain` command uses new pipeline

**Step 1: Implement `synthesizeV2(sessionIds, repoId, opts)`**
```
1. Extract: Promise.all(sessionIds.map(id => extractFragments(id)))  // Node 1, parallel
2. Load existing specs + compute signals
3. Organize: organizeGraph(allFragments, existingSpecs, signals)     // Node 2, one call
4. Write: Promise.all(changedSpecs.map(spec => writeSpec(spec, ...)))  // Node 3, parallel
5. Apply: applyGraphPlan(repoId, plan, writtenSpecs)                  // deterministic
6. createBrainVersion(repoId, commitSha)
```

**Step 2: Update CLI brain command** — call `synthesizeV2` instead of the per-session loop. Keep `--dry-run` (prints plan + specs without storing).

**Step 3: Run `npx tsc --noEmit` — verify types**

**Step 4: Run `npm test` — verify no regressions**

**Step 5: Commit**

---

### Task 7: Hierarchical markdown export

**Files:**
- Modify: `src/brain/generate-markdown.ts`

**Step 1: Update `generateBrainMarkdown`** — query topics with parent_topic_id, render as indented tree (roots first, children nested). Root specs get a one-line summary header.

**Step 2: Update `generateTopicMarkdown`** — add parent breadcrumb (`> Parent: [name](slug.md)`) and children list.

**Step 3: Run brain-export on real data, visually inspect output**

**Step 4: Commit**

---

### Task 8: EDD Judge

**Files:**
- Create: `src/eval/brain-judge.ts`

**Step 1: Implement judge** — Haiku scores brain export on 5 dimensions with Zod enum verdicts: `spec_quality` (design_doc/mixed/changelog), `hierarchy_coherence` (navigable/shallow/flat), `deduplication` (clean/some_overlap/redundant), `scope_precision` (focused/broad/tangled), `actionability` (actionable/vague/useless). Each returns `{ verdict, reasoning, examples }`.

**Step 2: Run baseline** — export current brain, score with judge, save results.

**Step 3: Run new pipeline on same sessions, score, compare.**

**Step 4: Commit**

---

### Task 9: End-to-end validation

**Step 1:** Run `npx tsx src/cli/index.ts brain <real-session-ids>` with new pipeline
**Step 2:** Run `npx tsx src/cli/index.ts brain-export`
**Step 3:** Inspect `.repo/brain.md` — verify tree structure
**Step 4:** Inspect `.repo/topics/*.md` — verify spec quality + breadcrumbs
**Step 5:** Run judge, verify improvement over baseline
**Step 6:** Run full test suite: `npm test && npx tsc --noEmit`
**Step 7:** Commit final state
