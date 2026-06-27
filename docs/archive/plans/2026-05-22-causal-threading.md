# Layer 0: Causal Threading & Interaction Analysis — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use .agent skills for EDD and agenting logic improvement

**Goal:** Add causal threading and interaction analysis so downstream LLM steps receive structured exchanges and actionable directives.

**Architecture:** Extend normalization with threading fields, add a new deterministic analysis step, modify moment detection prompts to use threaded format with conditional guidance.

**Tech Stack:** TypeScript, Vitest. No new dependencies. All changes are deterministic (no LLM calls).

**Spec:** `docs/superpowers/specs/2026-05-22-causal-threading-design.md`

**Approach:** Eval-Driven Development — write eval fixtures and criteria first, then implement to pass them.

---

### Task 1: Types & Eval Fixtures

**Files:**
- Modify: `src/adapters/types.ts`
- Create: `tests/fixtures/threading-session.jsonl`, `tests/eval/threading-criteria.ts`

**Step 1:** Add `respondingTo?: string` and `turnId: string` to `NormalizedDevEvent` in types.ts. Add `TurnExchange` and `PipelineDirectives` interfaces.

**Step 2:** Create a synthetic JSONL fixture (`threading-session.jsonl`) with 12-15 events covering: user question → AI multi-block response (text + tool_use + tool_use) → tool results → user short reply ("ok") → AI proposal with options A/B → user responds to only A → AI implements → user challenge with reasoning ("actually, instead..."). This fixture is the ground truth for all threading and analysis tests.

**Step 3:** Create `threading-criteria.ts` — expected outputs for the fixture:
- Expected `respondingTo` and `turnId` for each event
- Expected `TurnExchange[]` (which dev events pair with which AI turns)
- Expected `PipelineDirectives` (which flags should be true given the fixture's patterns)

**Step 4:** Commit.

---

### Task 2: Causal Threading

**Files:**
- Modify: `src/pipeline/normalize.ts`
- Create: `tests/pipeline/threading.test.ts`

**Step 1:** Write failing tests using the fixture + criteria: parse fixture → normalize → verify `respondingTo` and `turnId` on each event match expected values.

**Step 2:** Implement threading pass in `normalize()` — after category assignment, single pass through events assigning `respondingTo` and `turnId` per the spec's rules. Derive `turnId` from `rawEventId` by stripping block suffix.

**Step 3:** Run tests, verify pass. Commit.

---

### Task 3: Interaction Analysis

**Files:**
- Create: `src/pipeline/analyze.ts`, `tests/pipeline/analyze.test.ts`

**Step 1:** Write failing tests: threaded events from fixture → `analyzeInteractions()` → verify `TurnExchange[]` matches expected pairings, verify `PipelineDirectives` flags match criteria.

**Step 2:** Implement `analyzeInteractions(events: NormalizedDevEvent[]): PipelineDirectives`:
- Pair exchanges: find each `intent` event, look up the AI turn it responds to via `respondingTo` chain
- Compute per-exchange facts (chars, question marks, reasoning words, topic changes)
- Compute directive flags from thresholds

**Step 3:** Run tests, verify pass. Commit.

---

### Task 4: Threaded Prompt Format

**Files:**
- Modify: `src/llm/prompts/moments.ts`, `src/pipeline/moments.ts`
- Create: `tests/prompts/threaded-format.test.ts`

**Step 1:** Write test: given threaded events + directives, verify the prompt output contains exchange-grouped format and conditional guidance sections.

**Step 2:** Modify `buildPass1Prompt` to accept `PipelineDirectives`, render events in exchange-grouped format, inject guidance sections based on `promptSections` flags.

**Step 3:** Update `detectMoments()` signature to accept `directives: PipelineDirectives`, pass to prompt builder.

**Step 4:** Run all tests. Commit.

---

### Task 5: Pipeline Integration & Smoke Test

**Files:**
- Modify: `src/pipeline/orchestrator.ts`

**Step 1:** Insert `analyzeInteractions()` between normalize and classify. Pass directives to `detectMoments()`. Update step count logging.

**Step 2:** Smoke test against real CC log — run `intent digest --dry-run` and add a `--verbose` flag that prints the threaded exchange format and computed directives for inspection.

**Step 3:** Run full test suite. Commit.
