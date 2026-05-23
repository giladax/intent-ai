# Handoff: Repo Brain — Session 2

**Date:** 2026-05-23
**From:** Session that built brain synthesis, classifier, markdown generation, and storage
**For:** Successor wiring versioning, commit linking, and the full mutation pipeline

## What's Built

### Working pipeline (4 CLI commands)

```
intent brain <sessionId...>         # synthesize topics from sessions, store to DB
intent brain-classify <sessionId>   # Haiku relevance matching — session ↔ topics
intent brain-export                 # generate .repo/brain.md + .repo/topics/*.md
intent digest <path>                # session digestion (pre-existing)
```

### Files created this session

```
src/adapters/types.ts               — Brain types: Topic, Insight, FileRef, BrainVersion, BrainMutation
src/storage/schema.ts               — 7 new tables: topics, insights, insight_evidence, topic_files,
                                      topic_relations, topic_sessions, brain_versions
src/pipeline/brain-synthesis.ts     — Topic synthesis + storage + topic loading from DB
src/pipeline/brain-relevance.ts     — Haiku relevance classifier (session ↔ topics)
src/llm/prompts/brain-synthesis.ts  — Synthesis prompt + lenient Zod schema
src/llm/prompts/brain-relevance.ts  — Classifier prompt + schema
src/brain/generate-markdown.ts      — Markdown generation from DB (brain.md + topics/*.md)
tests/pipeline/brain-synthesis.test.ts — 8 tests for schema + prompt builder
.repo/brain.md                      — Generated root index (4 topics)
.repo/topics/*.md                   — Generated topic files
```

### Bug fixes (production impact, already in codebase)

1. `src/storage/connection.ts` — added `closeDb()` (process hang fix)
2. `src/cli/digest.ts` — calls `closeDb()` after pipeline
3. `src/llm/prompts/moments.ts` — evidence field optional with default (Zod crash)
4. `src/llm/client.ts` — switched to `client.messages.stream()` (10-min timeout fix)

### Current brain state in DB

4 topics from 1 intent-ai session:

| Topic | Insights | Categories |
|-------|----------|------------|
| tech stack and architecture | 4 | decision, constraint |
| digestion pipeline | 4 | structure, behavior, interface |
| moment detection | 5 | structure, decision, behavior, risk |
| eval-driven development | 2 | decision, behavior |

8 digested sessions across 4 projects: brain (4), telegram (2), telegram-tmp (1), intent-ai (1).

### EDD results

**Synthesis (4 iterations):**
- Evidence linking works (moment UUIDs, not positional indices)
- Meta leakage fixed (codebase knowledge only, no session process observations)
- Confidence discrimination: 85-99% range
- Multi-session merge works via DB upsert by topic name

**Classifier (3 sessions tested):**
- Same-project sessions: correct relevance scoring
- Cross-project sessions: caught conceptual analogies (generous but defensible)
- New topic suggestions: specific codebase concepts, not generic

## What's NOT Built

### 1. Brain versioning

`brain_versions` table exists but nothing writes to it. No version chain. No mutation records. The synthesis just overwrites — no audit trail of what changed.

### 2. Commit/PR linking

Sessions contain git commits in their tool call events, but we don't extract them. No mapping from session → commits → brain version.

### 3. Session-to-commit splitting

A session may contain 5 commits. We treat the session as one blob. To get proper versioning: split the session's contribution by commit, each commit anchors a brain version.

### 4. Two-stage pipeline wired together

The classifier and synthesizer work independently. Not connected into a single flow:
```
classify → filter relevant moments per topic → synthesize per topic → merge → verify → store
```

### 5. Verify-repair loop

Designed but not implemented. After parallel per-topic synthesis, a Haiku verifier checks for contradictions + evidence grounding. Sonnet repairs failures.

## Pipeline Design (agreed, not implemented)

```
Stage 0: Pre-compute (deterministic)
  - Collect session signals: narrative, arcs, moments, outcomes, chunk hints

Stage 1: Relevance Matching (Haiku, one call per session) ← BUILT
  - Per topic: high/low/none with reasoning
  - New topic candidates from orphan signals

Stage 2: Context Assembly (deterministic) ← NOT BUILT
  Per relevant topic:
  - Filter moments by relevance to this topic
  - Current topic insights from DB
  - Recent mutation summaries (last 3) for trend awareness

Stage 3: Synthesis (Sonnet, per topic, parallel) ← BUILT (but not scoped)
  Input: only the filtered context from Stage 2
  Output: create/update/deprecate insights

Stage 4: Merge (deterministic) ← NOT BUILT
  Aggregate per-topic mutations, detect conflicts

Stage 5: Verify (Haiku) ← NOT BUILT
  Coherence check, evidence grounding
  Fail → Repair (Sonnet) → re-verify (max 2 attempts)

Stage 6: Commit ← PARTIAL (storage works, no versioning)
  Store to DB, create BrainVersion, regenerate markdown
```

## Design Decisions Locked In

### 6 insight categories
structure, decision, constraint, behavior, risk, interface. Validated by adversarial review. Each category changes what an agent DOES with the insight.

### Topics are concepts, not files
"digestion pipeline" not "src/pipeline/". Topics emerge from sessions, not directory structure.

### Semantic matching, not file matching
Relevance is determined by meaning (Haiku classification of session signals against topic insights), not by file overlap. Files are weak signals — a change to `types.ts` doesn't tell you which topic is affected semantically.

### Brain evolves, never regenerates
Version N → evidence → mutation → version N+1. Only reviewed, evidence-backed insights enter the brain.

### Two evidence sources
Sessions (primary, rich) and PR diff analysis (fallback for commits without sessions). Build session path first, diff path later.

### Context for synthesis is scoped
Each Sonnet call sees only its topic's context — not the full brain. The classifier filters; Sonnet reasons within scope.

## Key Specs and Docs

| Document | What |
|----------|------|
| `docs/superpowers/specs/2026-05-23-repo-brain-design.md` | Brain spec (data model, pipeline, categories, dashboard) |
| `docs/plans/2026-05-23-repo-brain.md` | Implementation plan (24 tasks, 5 phases) |
| `docs/handoffs/2026-05-23-code-changes-brain-graph.md` | Original vision doc (mutation loop, versioned knowledge, insight model) |

## Next Steps

1. **Extract commit SHAs from session events** — tool_input/tool_output events contain `git commit` commands with SHAs. Build a deterministic extractor.
2. **Split session contributions by commit** — which moments/outcomes relate to which commit? Map moment → events → files → commit.
3. **Wire brain versioning** — each `intent brain` run creates a BrainVersion row. Mutations are recorded. Version chain is navigable.
4. **Wire the full pipeline** — `intent brain-sync` command: classify → assemble context → synthesize → merge → verify → store + version.
5. **Dashboard Phase 4** — Brain/Sessions tabs, topic map with counts, detail panel, chat, bidirectional file filtering.

## Tests

120 tests across 15 files, all passing. Brain-specific:
- `tests/pipeline/brain-synthesis.test.ts` — 8 tests (Zod schema parsing, prompt builder)
