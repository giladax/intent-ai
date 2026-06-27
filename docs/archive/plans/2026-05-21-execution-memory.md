# Execution Memory System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a TypeScript CLI that ingests Claude Code conversation logs and produces evidence-backed session digests.

**Architecture:** Monolith CLI — adapter parses CC logs into raw events, pipeline normalizes/chunks/detects moments/generates narrative, stores to Postgres via Drizzle, exposes `digest`, `explore`, and `eval` commands.

**Tech Stack:** TypeScript, Node.js, PostgreSQL, Drizzle ORM, Anthropic SDK, Commander.js, Zod, Vitest

**Spec:** `docs/superpowers/specs/2026-05-21-execution-memory-design.md`

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `.env.example`, `.gitignore`, `docker-compose.yml`, `drizzle.config.ts`, `src/cli/index.ts`

**Step 1: Initialize project**

```bash
cd /Users/giladkoch/dev/intent-ai
npm init -y
```

**Step 2: Install dependencies**

```bash
npm i typescript @anthropic-ai/sdk drizzle-orm postgres commander zod dotenv
npm i -D @types/node vitest drizzle-kit tsx
```

**Step 3: Create config files**

- `tsconfig.json`: strict mode, ESNext, NodeNext module resolution, `outDir: dist`
- `.env.example`: `DATABASE_URL`, `ANTHROPIC_API_KEY`
- `.gitignore`: `node_modules`, `dist`, `.env`
- `docker-compose.yml`: Postgres 16 on port 5432
- `drizzle.config.ts`: pointing to `src/storage/schema.ts`

**Step 4: Create CLI entry point**

`src/cli/index.ts`: Commander setup with `digest`, `explore`, `eval`, `up`, `down` subcommands (stubs).

**Step 5: Verify it runs**

Run: `npx tsx src/cli/index.ts --help`
Expected: help output listing all commands

**Step 6: Commit**

```bash
git add -A && git commit -m "feat: project scaffold with CLI stubs"
```

---

### Task 2: Storage Schema & Migrations

**Files:**
- Create: `src/storage/schema.ts`, `src/storage/connection.ts`, `src/cli/infra.ts`

**Step 1: Define Drizzle schema**

All tables from the spec: `sessions`, `raw_events`, `normalized_events`, `chunks`, `moments`, `moment_evidence`, `moment_relations`, `transitions`, `transition_moments`, `outcomes`, `outcome_moments`, `outcome_files`, `narratives`, `narrative_arcs`.

Use `pgTable` from drizzle-orm/pg-core. Use `uuid` for IDs, `jsonb` for raw, `text[]` for arrays, `int4range` for event ranges.

**Step 2: Create connection module**

`src/storage/connection.ts`: reads `DATABASE_URL` from env, exports drizzle client.

**Step 3: Wire up `intent up` / `intent down`**

`src/cli/infra.ts`: shell out to `docker compose up -d` / `docker compose down`.

**Step 4: Generate and run migration**

```bash
npx tsx src/cli/index.ts up
npx drizzle-kit generate
npx drizzle-kit migrate
```

Expected: all tables created in Postgres.

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: storage schema and docker compose"
```

---

### Task 3: Claude Code Adapter

**Files:**
- Create: `src/adapters/types.ts`, `src/adapters/claude-code.ts`, `src/utils/log-discovery.ts`
- Test: `tests/adapters/claude-code.test.ts`

**Step 1: Write failing test**

Create a fixture: a small JSONL file mimicking CC conversation format (3-5 turns: user message, AI response, tool call, tool result). Test that the adapter produces correct `RawDevEvent[]` with proper types and preserved raw.

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/adapters/claude-code.test.ts`
Expected: FAIL

**Step 3: Implement types and adapter**

- `src/adapters/types.ts`: `RawDevEvent` interface + Zod schema
- `src/adapters/claude-code.ts`: read JSONL, parse each line, map to `RawDevEvent`, skip malformed lines with warning
- `src/utils/log-discovery.ts`: scan `~/.claude/projects/`, find JSONL files, sort by mtime

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/adapters/claude-code.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: claude code adapter with log discovery"
```

---

### Task 4: Normalization

**Files:**
- Create: `src/pipeline/normalize.ts`
- Test: `tests/pipeline/normalize.test.ts`

**Step 1: Write failing test**

Test the category mapping table from the spec: user conversation_turn → intent, AI response before tool calls → proposal, Edit tool_call → action, Read tool_call → reflection, etc. Test causal ordering.

**Step 2: Run test, verify fail**

**Step 3: Implement normalization**

Deterministic transform: `RawDevEvent[] → NormalizedDevEvent[]`. Assign `causalOrder` by index. Classify `category` per the spec's mapping table. Generate `sessionId` UUID. Build `content.summary` from raw data.

**Step 4: Run test, verify pass**

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: event normalization with category rules"
```

---

### Task 5: Session Chunking

**Files:**
- Create: `src/pipeline/chunk.ts`
- Test: `tests/pipeline/chunk.test.ts`

**Step 1: Write failing tests**

Test cases:
- Short session (<10 events) → one chunk
- Pause-based split (>5min gap)
- File cluster shift split
- Size cap split at ~80 events
- 3-event overlap between chunks

**Step 2: Run test, verify fail**

**Step 3: Implement chunker**

Deterministic heuristics per spec. No LLM calls.

**Step 4: Run test, verify pass**

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: session chunking with heuristic splits"
```

---

### Task 6: LLM Client & Prompt Infrastructure

**Files:**
- Create: `src/llm/client.ts`, `src/llm/prompts/classify.ts`, `src/llm/prompts/moments.ts`, `src/llm/prompts/transitions.ts`, `src/llm/prompts/narrative.ts`

**Step 1: Create Anthropic SDK wrapper**

`src/llm/client.ts`: wraps `@anthropic-ai/sdk`, provides `callSonnet(prompt, schema)` and `callHaiku(prompt, schema)`. Both accept a Zod schema and return validated, typed output. Handles retries (3x exponential backoff) and validation retry (re-prompt once on Zod failure).

**Step 2: Create prompt templates**

Each template is a function that takes input data and returns a system + user message pair:
- `classify.ts`: session shape classification (Haiku)
- `moments.ts`: pass 1 per-chunk + pass 2 cross-chunk (Sonnet). Shape-specific variants.
- `transitions.ts`: transition + outcome detection (Sonnet)
- `narrative.ts`: narrative generation (Sonnet)

**Step 3: Commit**

```bash
git add -A && git commit -m "feat: LLM client with prompt templates"
```

---

### Task 7: Session Shape Classification

**Files:**
- Create: `src/pipeline/classify.ts`
- Test: `tests/pipeline/classify.test.ts`

**Step 1: Write test**

Mock the LLM client. Test that the classifier sends a summary of events to Haiku and returns a valid `SessionShape`.

**Step 2: Implement classifier**

Summarize the event stream (event count, file list, action types), send to Haiku, parse response as `SessionShape`.

**Step 3: Run test, verify pass. Commit.**

```bash
git add -A && git commit -m "feat: session shape classification"
```

---

### Task 8: Moment Detection (Pass 1 + Pass 2)

**Files:**
- Create: `src/pipeline/moments.ts`
- Test: `tests/pipeline/moments.test.ts`

This is the gold — spend time on prompt engineering and output quality.

**Step 1: Write tests**

Mock LLM client. Test:
- Pass 1 produces moments with all required fields (type, statement, significance, agency, confidence, topicFingerprint, evidence)
- Pass 2 merge rules: same type+fingerprint+adjacent → merged, different types+same fingerprint → linked via arc, non-adjacent same → kept separate
- Evidence quotes have structured `Evidence` objects

**Step 2: Implement pass 1**

Per-chunk, parallelized with `Promise.all`. Send chunk events + session shape to Sonnet. Parse structured moments with Zod validation.

**Step 3: Implement pass 2**

Receives all pass-1 candidates. Groups by `topicFingerprint`. Applies merge rules. Assigns `arcId` and `arcRole`. Emits `relatedMomentIds`.

**Step 4: Run tests, verify pass. Commit.**

```bash
git add -A && git commit -m "feat: moment detection two-pass pipeline"
```

---

### Task 9: Transitions & Outcomes

**Files:**
- Create: `src/pipeline/transitions.ts`, `src/pipeline/outcomes.ts`
- Test: `tests/pipeline/transitions.test.ts`, `tests/pipeline/outcomes.test.ts`

**Step 1: Write tests**

Mock LLM. Test:
- Transitions derived from complementary moment pairs
- Outcomes require both commitment moment AND file evidence
- Confidence propagated

**Step 2: Implement**

Single Sonnet call receives all moments. Returns both `IntentTransition[]` and `AcceptedOutcome[]`.

**Step 3: Run tests, verify pass. Commit.**

```bash
git add -A && git commit -m "feat: intent transitions and accepted outcomes"
```

---

### Task 10: Narrative Generation

**Files:**
- Create: `src/pipeline/narrative.ts`
- Test: `tests/pipeline/narrative.test.ts`

**Step 1: Write test**

Mock LLM. Test that narrative includes: summary, progression, discoveries, stabilizedDirections, abandonedDirections, arcs with resolution status.

**Step 2: Implement**

Sonnet call receives moments + transitions + outcomes. Returns `SessionNarrative` with `NarrativeArc[]`.

**Step 3: Run tests, verify pass. Commit.**

```bash
git add -A && git commit -m "feat: session narrative generation"
```

---

### Task 11: Pipeline Orchestrator

**Files:**
- Create: `src/pipeline/orchestrator.ts`, `src/storage/queries.ts`
- Test: `tests/pipeline/orchestrator.test.ts`

**Step 1: Write test**

Integration-style test with mocked LLM client. Feed a fixture through the full pipeline (adapter → normalize → classify → chunk → moments → transitions → narrative → store). Verify all tables populated.

**Step 2: Implement orchestrator**

`runPipeline(logPath: string)`: executes all 10 steps sequentially. Wraps DB writes in a transaction. Prints narrative to stdout.

**Step 3: Implement storage queries**

`src/storage/queries.ts`: insert functions for each table, query functions for reading sessions/moments/narratives.

**Step 4: Run test, verify pass. Commit.**

```bash
git add -A && git commit -m "feat: pipeline orchestrator with storage"
```

---

### Task 12: `intent digest` Command

**Files:**
- Create: `src/cli/digest.ts`

**Step 1: Wire up the command**

Reads path argument or auto-discovers latest CC log. Calls `runPipeline`. Formats and prints the narrative output (summary, arcs, outcomes, abandoned directions).

**Step 2: Add `--last N` flag**

Loops over N most recent sessions.

**Step 3: Add large session cost warning**

If >300 normalized events, print estimate and prompt for confirmation.

**Step 4: Manual test against a real CC session log. Commit.**

```bash
git add -A && git commit -m "feat: intent digest command"
```

---

### Task 13: `intent explore` Command

**Files:**
- Create: `src/cli/explore.ts`

**Step 1: Implement REPL**

Readline-based loop. Loads session digest from Postgres (narrative, moments, transitions, outcomes). Builds system prompt with structured digest as context. Sends user questions to Sonnet. Streams responses. Maintains in-memory conversation history.

**Step 2: Add session selection**

`--session <id>` flag. Default: most recent session.

**Step 3: Manual test. Commit.**

```bash
git add -A && git commit -m "feat: intent explore conversational REPL"
```

---

### Task 14: Eval Harness

**Files:**
- Create: `src/eval/fixtures/` (curated JSONL files), `src/eval/criteria.ts`, `src/eval/runner.ts`, `src/eval/judge.ts`, `src/cli/eval.ts`

**Step 1: Create 2-3 initial fixtures**

Curate from real CC session logs. At minimum: one narrative session, one short session.

**Step 2: Define criteria**

Per fixture, per pipeline step: expected moment counts, types, key topics that should appear.

**Step 3: Implement LLM-as-judge**

`judge.ts`: sends pipeline output + criteria to Claude, returns 1-5 score with explanation.

**Step 4: Implement runner**

`runner.ts`: runs pipeline against each fixture, collects judge scores, prints report table.

**Step 5: Wire up `intent eval` command**

`--fixture` and `--step` flags for targeted runs.

**Step 6: Run eval suite. Commit.**

```bash
git add -A && git commit -m "feat: eval harness with fixtures and LLM judge"
```

---

### Task 15: End-to-End Smoke Test

**Step 1: Run full flow against a real session**

```bash
npx tsx src/cli/index.ts up
npx tsx src/cli/index.ts digest
npx tsx src/cli/index.ts explore
npx tsx src/cli/index.ts eval
npx tsx src/cli/index.ts down
```

**Step 2: Fix any issues discovered**

**Step 3: Final commit**

```bash
git add -A && git commit -m "feat: end-to-end smoke test pass"
```
