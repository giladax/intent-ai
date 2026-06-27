# Brain Cards Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add card generation from existing specs, promote Gen2B to main organize prompt, update markdown export.

**Architecture:** Cards are deterministically derived from full specs. Gen2B's `level: root|child` schema replaces current organize prompt. Export renders cards at top of each topic file.

**Tech Stack:** TypeScript, Zod, Postgres/Drizzle, Vitest

---

### Task 1: Promote Gen2B to main organize prompt

**Files:**
- Modify: `src/llm/prompts/brain-organize.ts`

**Step 1:** Replace the current prompt builder and schema with Gen2B's version. Copy the `level` field on AssignmentSchema and MergeSchema, the rewritten system prompt, and remove `conceptualMap` from the schema. Keep the same function signature `buildBrainOrganizePrompt(existingSpecs, fragments, signals)`.

**Step 2:** Run `npx vitest run tests/pipeline/brain-organize.test.ts` — fix any tests that break from schema changes (add `level` to test fixtures).

**Step 3:** Run `npm test` — verify no regressions.

**Step 4:** Commit: `feat: promote Gen2B level schema to main organize prompt`

---

### Task 2: Card type + generation function

**Files:**
- Create: `src/brain/cards.ts`
- Create: `tests/brain/cards.test.ts`

**Step 1:** Write failing tests:
- `generateCard` produces a card from a full spec (name, summary truncated to ~150 words, top 5 insights, files, parent, children)
- Card includes `level`, `sessions`, `versionId`
- Insights are deduplicated and capped at 5

**Step 2:** Implement `generateCard(spec, level, parent, children, sessions, versionId) → BrainCard`. Pure function, no DB. Deterministic compression of the full spec into a card.

**Step 3:** Export `BrainCard` interface from `src/adapters/types.ts`.

**Step 4:** Run tests, verify pass.

**Step 5:** Commit: `feat: card generation from specs`

---

### Task 3: Store cards in DB

**Files:**
- Create: `drizzle/0005_brain_cards.sql`
- Modify: `src/storage/schema.ts`
- Modify: `src/pipeline/brain-synthesis.ts` — generate + store cards after `applyGraphPlan`

**Step 1:** Write migration:
```sql
CREATE TABLE brain_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_name TEXT NOT NULL,
  level TEXT NOT NULL,
  path TEXT,
  parent_node TEXT,
  summary TEXT NOT NULL,
  insights JSONB NOT NULL DEFAULT '[]',
  files JSONB DEFAULT '[]',
  exports JSONB DEFAULT '[]',
  related JSONB DEFAULT '[]',
  children JSONB DEFAULT '[]',
  sessions JSONB DEFAULT '[]',
  version_id UUID REFERENCES brain_versions(id),
  repo_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(repo_id, node_name)
);
```

**Step 2:** Add table to `schema.ts`.

**Step 3:** In `synthesizeV2`, after `applyGraphPlan` and `createBrainVersion`, generate cards for all changed specs and upsert to `brain_cards`.

**Step 4:** Run `npx tsx src/cli/index.ts up` to apply migration.

**Step 5:** Commit: `feat: brain_cards table + card storage in pipeline`

---

### Task 4: Update markdown export with cards

**Files:**
- Modify: `src/brain/generate-markdown.ts`

**Step 1:** In `generateBrainMarkdown`, query `brain_cards` and render tree using card summaries instead of raw topic summaries. Each root area gets a heading with its card summary, children indented with their card summaries.

**Step 2:** In `generateTopicMarkdown`, prepend the card as a frontmatter-style block at the top of each topic file:
```markdown
<!-- card -->
> **Moment Detection** (spec, child of Pipeline Architecture)
> Coarse-then-fine moment detection. Originally timed out until switched to streaming.
> Key: [constraint] Agency field required · [risk] 64K output limit on large sessions
> Files: src/pipeline/moments-p1.ts, moments-p2.ts
<!-- /card -->
```

**Step 3:** Run brain pipeline on real data, export, inspect output.

**Step 4:** Commit: `feat: markdown export with card summaries`

---

### Task 5: End-to-end validation

**Step 1:** Clear brain data, run `npx tsx src/cli/index.ts brain <sessionIds>` with Gen2B prompt.
**Step 2:** Run `npx tsx src/cli/index.ts brain-export`, inspect `.repo/brain.md` for tree + card summaries.
**Step 3:** Verify `brain_cards` table has entries: `SELECT node_name, level, LEFT(summary, 60) FROM brain_cards`.
**Step 4:** Run `npm test && npx tsc --noEmit`.
**Step 5:** Commit final state.
