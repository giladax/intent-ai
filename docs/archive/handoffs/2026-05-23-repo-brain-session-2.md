# Handoff: Repo Brain — Session 2

**Date:** 2026-05-23
**From:** Session that built the brain vertical slice end-to-end
**For:** Successor wiring the full two-stage pipeline and dashboard

## What's Built and Working

### CLI commands

```
intent brain <sessionId...>         # synthesize topics, store to DB, create brain version
intent brain-classify <sessionId>   # Haiku relevance matching — session ↔ topics
intent brain-export                 # generate .repo/brain.md + .repo/topics/*.md
intent digest <path>                # session digestion (pre-existing)
```

### Brain versioning — working

Each `intent brain` run creates a `BrainVersion` with a parent pointer. Tested with 2 sequential sessions:
- v1 (`28223be8`): 5 topics from session 1, no parent
- v2 (`e30ae1f3`): 1 new topic from session 2, parent = v1

Version chain is stored in `brain_versions` table with `parent_version_id`.

### Topic synthesis — working, EDD-validated

4 prompt iterations converged on:
- Evidence linking via moment UUIDs (not positional indices)
- No meta leakage (codebase knowledge only)
- Confidence discrimination: 85-99%
- Multi-session merge via DB upsert by topic name

### Relevance classifier — working, EDD-validated

Haiku classifies session relevance to existing topics using full session signals (narrative, arcs, moments, outcomes, chunk hints). Tested on 3 sessions:
- Same-project: correct high/low/none scoring
- Cross-project: caught conceptual analogies
- Suggests new topics for uncovered concepts

### Markdown generation — working

`.repo/brain.md` (root index with topic list + file map) and `.repo/topics/<name>.md` (per-topic: insights by category, files, evidence sessions, related topics). Relative file paths.

### Current DB state

6 topics, 2 brain versions, 8 digested sessions across 4 projects.

### Files

```
src/adapters/types.ts               — Brain types (Topic, Insight, BrainVersion, BrainMutation, etc.)
src/storage/schema.ts               — 7 tables, 2 enums
src/pipeline/brain-synthesis.ts     — Synthesis + storage + versioning + topic loading
src/pipeline/brain-relevance.ts     — Haiku relevance classifier
src/llm/prompts/brain-synthesis.ts  — Synthesis prompt + lenient Zod schema
src/llm/prompts/brain-relevance.ts  — Classifier prompt + schema
src/brain/generate-markdown.ts      — Markdown generation from DB
tests/pipeline/brain-synthesis.test.ts — 8 tests
.repo/brain.md + .repo/topics/*.md  — Generated output
docs/superpowers/specs/2026-05-23-repo-brain-design.md — Spec
docs/plans/2026-05-23-repo-brain.md — Plan (24 tasks, 5 phases)
docs/handoffs/2026-05-23-code-changes-brain-graph.md — Original vision
```

### Bug fixes in this session

1. `storage/connection.ts` — `closeDb()` for process hang
2. `cli/digest.ts` — calls `closeDb()` after pipeline
3. `llm/prompts/moments.ts` — evidence field optional (Zod crash on large sessions)
4. `llm/client.ts` — `client.messages.stream()` (10-min timeout fix)

## What's NOT Built

### 1. Two-stage pipeline wired together

Classifier and synthesizer work independently. Not connected into:
```
classify → assemble scoped context per topic → synthesize per topic → merge → verify → store
```

### 2. Scoped context assembly

Synthesis currently sees ALL moments. Should see only moments relevant to each topic (filtered by the classifier's output). The context per Sonnet call should be:
- Topic's current insights
- Only relevant moments/outcomes (filtered by semantic relevance, not file overlap)
- Recent mutation summaries (last 3) for trend awareness

### 3. Verify-repair loop

After parallel per-topic synthesis, Haiku verifier checks coherence + evidence grounding. Sonnet repairs failures. Max 2 repair attempts.

### 4. Mutation tracking

Brain versions exist but don't record WHAT changed. No diff between versions. The `BrainMutation` type exists in `types.ts` but has no DB table or storage logic. Need: which insights were created/updated/deprecated in each version.

### 5. Dashboard (Phase 4)

Brain/Sessions tabs, topic map with session/moment counts, detail panel, chat scoped to topics, bidirectional file filtering.

## Pipeline Design (agreed)

```
Stage 0: Pre-compute (deterministic)
  Collect session signals: narrative, arcs, moments, outcomes, chunk hints

Stage 1: Relevance Matching (Haiku) ← BUILT
  Per topic: high/low/none with reasoning
  New topic candidates from orphan signals

Stage 2: Context Assembly (deterministic) ← NOT BUILT
  Per relevant topic: filter moments, load insights, load recent mutations

Stage 3: Synthesis (Sonnet, per topic, parallel) ← BUILT (not scoped)
  Input: scoped context from Stage 2
  Output: create/update/deprecate insights

Stage 4: Merge (deterministic) ← NOT BUILT
  Aggregate per-topic mutations, detect conflicts

Stage 5: Verify (Haiku) ← NOT BUILT
  Coherence + evidence grounding check
  Fail → Repair (Sonnet) → re-verify (max 2)

Stage 6: Commit ← BUILT
  Store to DB, create BrainVersion, regenerate markdown
```

## Design Decisions Locked In

- **6 categories**: structure, decision, constraint, behavior, risk, interface
- **Topics are concepts**, not files — emerge from sessions
- **Semantic matching**, not file matching — files are weak signals for topic relevance
- **Brain evolves**, never regenerates — version N → mutation → version N+1
- **Sessions are primary evidence** — diff analysis is fallback for commits without sessions
- **Context is scoped** — each Sonnet call sees only its topic's relevant context
- **Haiku classifies, Sonnet synthesizes** — cheap routing, expensive reasoning

## Next Steps

1. **Wire the full pipeline** — `intent brain-sync`: classify → context assembly → parallel synthesis → merge → verify → store + version
2. **Add mutation tracking** — record what changed per version (created/updated/deprecated insights)
3. **Dashboard** — Brain/Sessions tabs, topic map, detail panel, chat, file graph
4. **Run all 8 sessions through the brain** — build the full knowledge graph, validate versioning across sessions from different projects

## Tests

120 tests across 15 files, all passing.
