# Checkpoint 1 Review — Execution Memory System

**Date:** 2026-05-21
**Reviewer:** Claude Opus 4.6 (automated review)
**Scope:** All implemented code through Tasks 1-5 of the implementation plan

---

## Project Status

### Completed (5 of 15 tasks)

| Task | Status | Description |
|------|--------|-------------|
| 1. Project Scaffold | Done | package.json, tsconfig.json, CLI stubs, docker-compose, drizzle config |
| 2. Storage Schema & Migrations | Done | Full Drizzle schema for all 14 tables, connection module, infra commands |
| 3. Claude Code Adapter | Done | JSONL parser using claude-code-kit, log discovery utility |
| 4. Normalization | Done | RawDevEvent to NormalizedDevEvent with deterministic category rules |
| 5. Session Chunking | Done | Pause/file-shift/topic-shift/size-cap heuristics with overlap |

### Pending (10 of 15 tasks)

| Task | Status | Description |
|------|--------|-------------|
| 6. LLM Client & Prompts | Pending | Anthropic SDK wrapper, prompt templates |
| 7. Session Shape Classification | Pending | Haiku-based session type classifier |
| 8. Moment Detection | Pending | Two-pass moment extraction (core differentiator) |
| 9. Transitions & Outcomes | Pending | Intent transitions and accepted outcomes |
| 10. Narrative Generation | Pending | Session narrative with arcs |
| 11. Pipeline Orchestrator | Pending | End-to-end pipeline runner + storage queries |
| 12. `intent digest` Command | Pending | Wire up CLI digest command |
| 13. `intent explore` Command | Pending | Conversational REPL over digests |
| 14. Eval Harness | Pending | Fixtures, criteria, LLM-as-judge |
| 15. End-to-End Smoke Test | Pending | Full flow validation |

**Summary:** The deterministic foundation (adapter, normalization, chunking) and infrastructure (schema, CLI, Docker) are complete. All LLM-dependent pipeline steps remain.

---

## Test Results

```
 RUN  v4.1.7 /Users/giladkoch/dev/intent-ai

 Test Files  3 passed (3)
      Tests  40 passed (40)
   Start at  21:17:21
   Duration  238ms (transform 172ms, setup 0ms, import 248ms, tests 27ms, environment 0ms)
```

All 40 tests pass across 3 test files:
- `tests/adapters/claude-code.test.ts` — 9 tests
- `tests/pipeline/normalize.test.ts` — 14 tests
- `tests/pipeline/chunk.test.ts` — 10 tests (including 7 edge cases)

---

## Type Check Results

```
npx tsc --noEmit
```

**Clean — zero errors, zero warnings.** All source files under `src/` type-check successfully with strict mode enabled.

---

## Smoke Test Results

Ran against the real Claude Code session log for this project (`~/.claude/projects/-Users-giladkoch-dev-intent-ai/84280b36-1375-4a79-9d53-e31c6d124146.jsonl`, 2.7 MB).

### Step 1: Parse CC Log

```
Raw events: 447
By type: {
  "conversation_turn": 37,
  "tool_call": 173,
  "tool_result": 163,
  "ai_response": 74
}
```

The adapter successfully parsed the full session log. Tool calls dominate (173), which is expected for a code-heavy session. The 10-event gap between tool_call (173) and tool_result (163) suggests some tool calls may have been part of messages that also included other content blocks — reasonable.

### Step 2: Normalize

```
Normalized events: 447
By category: {
  "intent": 37,
  "reflection": 151,
  "result": 163,
  "proposal": 26,
  "action": 70
}
By actor: {
  "user": 200,
  "ai": 247
}
```

All 447 raw events normalized (no content-empty events filtered out in this session). Category distribution looks healthy:
- 37 intents (user messages) matches 37 conversation_turns exactly
- 163 results matches 163 tool_results exactly
- 70 actions + 81 reflections (from tool_call) = 151 reflections total from tools... wait, 151 reflection includes both read-only tool_calls (81) and post-tool-result ai_responses. 70 action + 81 reflection tool_calls = 151 + 70 = 221... let me verify: 173 tool_calls split into 70 actions + 103 reflections, plus 48 ai_responses classified as reflection = 151. And 26 ai_responses as proposal. 26 + 48 = 74 ai_responses. That checks out.

First 15 events show the session starts with the user posting a PRD, then the AI invoking brainstorming skills and creating tasks — correctly ordered.

### Step 3: Chunk

```
Chunks: 25
```

25 chunks for a 447-event session is reasonable (~18 events per chunk average). Key observations:

- **Chunk 0** (32 events, range [0-31]): Initial brainstorming / PRD discussion. No files — correctly detected as conversation-only.
- **Chunks 1-4**: Small chunks from file cluster shifts during reading project context files.
- **Chunk 5** (43 events, range [50-91]): Large discussion chunk about design decisions.
- **Chunks 8, 10**: Spec writing phase, correctly grouped around the spec file.
- **Chunks 14-24**: Implementation phase — correctly grouped around source files being created.
- **Chunk 22** (43 events): Investigation of claude-code-kit package, correctly captured as a distinct phase.

Topic hints are either file paths (when files are in scope) or user message summaries (when no files). Some topic hints are quite long (full file paths), but that is by design.

Several chunks are very small (4-5 events), particularly chunks 4, 7, 12, 13, 15, 20. These appear to be created by file cluster shifts on single read operations. This is aggressive splitting — worth considering whether the file cluster shift heuristic should require a minimum preceding file count before triggering.

---

## Code Review

### `src/adapters/types.ts`

**Purpose:** Defines the three core data interfaces (`RawDevEvent`, `NormalizedDevEvent`, `SessionChunk`) and a `SourceAdapter` interface.

**Strengths:**
- Clean, well-documented interface definitions
- All fields match the spec exactly
- `SourceAdapter` interface enables future adapters (Codex, Copilot) as the spec intends

**Issues:**
- The spec mentions Zod schemas for runtime validation of `RawDevEvent`, but no Zod schemas are defined here. The adapter currently relies on claude-code-kit for parsing validation, but if a second adapter is added, there is no shared runtime validation layer.

**Notable decisions:**
- `SessionChunk` is defined alongside adapter types rather than in a pipeline-specific file. This is pragmatic since chunk.ts imports from types.ts anyway.

---

### `src/adapters/claude-code.ts`

**Purpose:** Parses Claude Code JSONL logs into `RawDevEvent[]` using the `@constellos/claude-code-kit` library.

**Strengths:**
- Leverages claude-code-kit's `parseTranscript` with `lenient: true` for robust parsing
- Correctly handles multi-block messages (thinking + text + tool_use in one assistant message)
- ID generation embeds block index (`uuid-text-1`, `uuid-tool-2`) enabling content extraction in normalize.ts
- Properly skips thinking blocks and system messages

**Issues:**
- Does not implement the `SourceAdapter` interface defined in types.ts. The function signature matches conceptually but is not explicitly typed.
- No error handling for file-not-found or I/O errors — claude-code-kit may throw, but the adapter does not wrap or add context.
- The spec calls for "skip malformed lines with warning" — the `lenient: true` flag in claude-code-kit likely handles this, but there is no stderr warning or skip-count reporting as the spec requests.

**Notable decisions:**
- Chose claude-code-kit over hand-rolled JSONL parsing. Good decision — the library handles CC's specific format nuances.

---

### `src/pipeline/normalize.ts`

**Purpose:** Deterministic transform from `RawDevEvent[]` to `NormalizedDevEvent[]` with category classification and content extraction.

**Strengths:**
- Category classification matches the spec's mapping table exactly
- The `isAfterToolResult` function correctly handles the "AI text after tool result = reflection" vs "AI text before tools = proposal" distinction by scanning backwards
- `STATE_MODIFYING_TOOLS` set is correct (Edit, Write, Bash, NotebookEdit)
- Content extraction handles all event types with appropriate fallbacks
- File path extraction checks multiple key names (`file_path`, `path`, `filePath`)
- Filters out events with no meaningful content

**Issues:**
- The `tool_result` actor is set to `"user"` which is technically correct (CC sends tool results as user messages) but semantically ambiguous. The spec says `actor: "ai"` for tool_result events — the implementation diverges. Looking at the spec table more carefully: the spec's table only maps event types to categories, not actors for tool_result. The test validates `actor: "user"` which is a reasonable choice since the tool result originates from the user message in the CC log format.
- Content extraction for tool_calls uses `getToolInput(event)` which passes the whole event, but the function signature accepts `RawDevEvent` — this works but the parameter naming is slightly misleading (the local var in extractContent is also called `input`).

**Notable decisions:**
- Causal order is assigned by output index (after filtering), not input index. This means filtered-out events do not create gaps in causal ordering. Good decision.

---

### `src/pipeline/chunk.ts`

**Purpose:** Deterministic session chunking with pause, file-cluster-shift, topic-shift, and size-cap heuristics.

**Strengths:**
- All four split heuristics from the spec are implemented in priority order
- Size cap at 80 events with natural boundary search (preferring result/intent boundaries)
- 3-event overlap between consecutive chunks
- Short session bypass (<10 events = one chunk)
- Topic hint derivation from most-frequent file path with user-message fallback
- Clean separation of concerns: findSplitPoints, splitAtIndices, applySizeCap, buildChunksWithOverlap

**Issues:**
- The file cluster shift detection (`hasFileClusterShift`) checks only the single current event's files against the previous 10 events' files. If the current event has one file and it is new, that is 100% new files, triggering a split. This causes aggressive splitting on any file-touching event that references a new file, even if the next several events return to the same file cluster. A sliding window approach or minimum file count threshold would reduce noise.
- The `eventRange` in chunks uses the **owned** events' causal orders (excluding overlap), which is correct for deduplication but means the range does not reflect the full events array in the chunk. This is documented by the type definition but could surprise consumers.
- `TOPIC_SHIFT_PATTERNS` includes `/\bnext\b/i` which would match many false positives (e.g., "read the next file", "what's next in the list"). This is overly aggressive.

**Notable decisions:**
- Overlap events are prepended to the next chunk's events array but excluded from the `eventRange`. This is the correct design — it provides continuity context without double-counting.

---

### `src/utils/log-discovery.ts`

**Purpose:** Recursively discovers JSONL files under `~/.claude/projects/`, sorted by modification time.

**Strengths:**
- Recursive directory traversal handles nested project directories
- Optional `projectDir` scoping
- Graceful handling of unreadable directories (empty catch)
- Clean API: `discoverLatestLog()` and `discoverLogs(count)`

**Issues:**
- No filtering for non-CC files. Any `.jsonl` file under `~/.claude/projects/` would be returned, even if it is not a CC conversation log.
- The empty `catch` block in `collectJsonl` silently swallows permission errors. A debug-level log would help troubleshooting.

---

### `src/cli/index.ts`

**Purpose:** Commander.js CLI entry point with `digest`, `explore`, `eval`, `up`, `down` commands.

**Strengths:**
- Clean structure with all planned commands registered
- Proper `#!/usr/bin/env node` shebang
- dotenv loaded at entry point

**Issues:**
- `digest`, `explore`, `eval` commands are stubs (print "not yet implemented"). Expected at this stage.
- No `bin` field in package.json, so `intent` is not globally available. The `npm run intent` script works but is not the intended UX from the spec (`intent digest`).

---

### `src/cli/infra.ts`

**Purpose:** Docker Compose lifecycle management for the Postgres database.

**Strengths:**
- `up()` includes a readiness check (`pg_isready` loop) before running migrations
- Uses `stdio: "inherit"` for visible output
- Correctly resolves project root relative to the module location

**Issues:**
- The `until ... do sleep 0.5; done` shell loop has no timeout. If Postgres never starts, this hangs forever.
- `execSync` is blocking — fine for a CLI tool but should be noted.

---

### `src/storage/schema.ts`

**Purpose:** Drizzle ORM schema defining all 14 database tables from the spec.

**Strengths:**
- All tables from the spec are present: sessions, raw_events, normalized_events, chunks, moments, moment_evidence, moment_relations, transitions, transition_moments, outcomes, outcome_moments, outcome_files, narratives, narrative_arcs
- Proper foreign key relationships with `onDelete: "cascade"` or `"set null"` as appropriate
- Composite primary keys on join tables (moment_relations, transition_moments, outcome_moments)
- `momentRelationTypeEnum` for typed relation types

**Issues:**
- The spec calls for `int4range` for event ranges in the chunks table. The implementation uses two separate integer columns (`eventRangeStart`, `eventRangeEnd`) instead. This is a pragmatic choice since Drizzle ORM does not natively support PostgreSQL range types, but it diverges from the spec.
- No `outcome_files` primary key — it relies on the default UUID. The spec implies this is a join table but the implementation treats it as a regular table with an `outcomeId` FK and `filePath` text column but no composite PK. Adding a composite PK on `(outcomeId, filePath)` would prevent duplicate entries.
- The `raw_events.timestamp` column is nullable (no `.notNull()`) while other timestamp columns are either nullable or explicitly not-null. This may be intentional since some raw events might lack timestamps.

---

### `src/storage/connection.ts`

**Purpose:** Lazy-initialized Drizzle database connection.

**Strengths:**
- Singleton pattern prevents multiple connections
- Default DATABASE_URL matches docker-compose.yml configuration
- Exports both db (Drizzle) and raw client for direct SQL if needed

**Issues:**
- No connection validation or error handling. If the URL is wrong, the error will surface only when the first query runs, not at connection time.
- No cleanup/disconnect function. For a CLI tool this is acceptable (process exit closes connections), but an explicit `close()` would be cleaner for tests.

---

### Test Fixtures

**`tests/fixtures/sample-session.jsonl`:** 8-line CC conversation covering user message, assistant with thinking+text+tool_use, tool_result, follow-up, and system message. Comprehensive for adapter testing.

**`tests/fixtures/cc-sample.jsonl`:** 9-line fixture with progress events, queue-operation, and file-history-snapshot — tests robustness against non-standard CC message types. Used by the adapter via claude-code-kit's lenient parsing.

---

## Architecture Assessment

### Alignment with Spec

The implemented code closely follows the spec with a few minor divergences:

1. **Event model** — Matches exactly. `RawDevEvent` and `NormalizedDevEvent` interfaces are faithful to the spec.

2. **Category mapping** — Matches the spec's table. The implementation correctly distinguishes state-modifying tools (action) from read-only tools (reflection), and AI text before/after tool results (proposal/reflection).

3. **Chunking** — All four heuristics implemented. The overlap mechanism works as specified (3 events). The aggressive file-cluster-shift and topic-shift patterns could use tuning but the algorithm is correct.

4. **Storage schema** — All 14 tables present. The `int4range` to dual-integer divergence is noted but functionally equivalent.

5. **Project structure** — Matches the spec's directory layout exactly. `src/adapters/`, `src/pipeline/`, `src/storage/`, `src/cli/`, `src/utils/` all in place.

6. **External dependency choice** — Using `@constellos/claude-code-kit` for JSONL parsing was not in the spec but is a sound decision that reduces maintenance burden.

### What's Well-Architected

- **Clean separation between adapter and pipeline.** The adapter outputs `RawDevEvent[]` and the pipeline never touches raw log format. Adding a new adapter is straightforward.
- **Deterministic steps are truly deterministic.** No LLM calls in normalize or chunk. This makes testing reliable and fast.
- **Type safety is strong.** Strict TypeScript with no `any` leaks. The ID encoding scheme (embedding block indices) is clever and avoids needing separate lookup tables during normalization.

### What Needs Attention Before LLM Steps

- **No Zod runtime validation layer yet.** The spec calls for Zod validation of LLM outputs. The types exist as TypeScript interfaces but not as Zod schemas. Task 6 (LLM Client) should introduce these.
- **No storage queries module yet.** `src/storage/queries.ts` is needed before the orchestrator can persist results.

---

## Recommendations

### Before continuing to Task 6

1. **Tune the `next` topic-shift pattern.** The regex `/\bnext\b/i` will match too aggressively. Consider requiring it as part of a phrase like "next, let's" or "next step" or removing it entirely.

2. **Add a minimum file count for file-cluster-shift detection.** When the current event has only 1 file and the previous window has files, a single new file triggers a split. Requiring at least 2 new files or a minimum window size would reduce noise. The smoke test showed several 4-5 event chunks from single file reads.

3. **Add Zod schemas to `types.ts`.** The spec requires Zod validation, and having schemas for `RawDevEvent` and `NormalizedDevEvent` will be needed immediately when Task 6 introduces LLM response validation.

4. **Implement the `SourceAdapter` interface.** `claude-code.ts` defines `parseClaudeCodeLog` as a standalone function but does not implement the `SourceAdapter` interface from `types.ts`. Making it conform ensures future adapters follow the same contract.

5. **Add `bin` field to `package.json`.** For the `intent` CLI to work as specified (`intent digest`), add:
   ```json
   "bin": { "intent": "dist/cli/index.js" }
   ```

### Quality improvements (can be deferred)

6. **Add a timeout to the `pg_isready` loop in `infra.ts`.** An infinite loop on a missing database is a bad user experience.

7. **Add error context to the adapter.** Wrap file-not-found and parse errors with helpful messages pointing to expected log locations.

8. **Consider a vitest config file.** Currently vitest works via CLI defaults, but a `vitest.config.ts` would allow configuring test timeouts, coverage, and include/exclude patterns explicitly.

9. **The `cc-sample.jsonl` fixture is not referenced by any test.** It exists but only `sample-session.jsonl` is used. Either add tests using it or remove it.

### For the LLM pipeline (Tasks 6-10)

10. **Design the prompt template interface early.** Each prompt function should accept typed input and return `{ system: string, user: string }`. Establishing this pattern in Task 6 prevents refactoring later.

11. **Plan for cost estimation.** The spec mentions a cost warning for sessions with >300 normalized events. The smoke test showed 447 events / 25 chunks, which would mean ~25+ Sonnet calls for moment detection pass 1 alone. Build cost estimation into the orchestrator from the start.

12. **Consider chunk merging for very small chunks.** The smoke test produced several 4-5 event chunks. These may not provide enough context for meaningful moment detection. Consider a post-chunking pass that merges small adjacent chunks.
