# digestion pipeline

The intent-ai digestion pipeline is a sequential, single-process pipeline triggered via `intent digest` that transforms Claude Code conversation logs (JSONL files) into structured semantic moments stored in Postgres. It uses a two-pass LLM strategy: Haiku for cheap structural classification of exchanges, and Sonnet for expensive semantic moment detection and session transition analysis. The primary data source is Claude Code conversation logs rather than git diffs — every Edit, Write, and Bash tool call is recorded with full reasoning context, making them semantically richer than git history. The pipeline has several hard-won robustness constraints: the Anthropic client must use `client.messages.stream()` to avoid timeouts on large sessions; Zod schemas must be lenient to handle LLM output variation; the Postgres connection pool must be explicitly closed after completion to prevent process hang; and a dedup guard using the CC session UUID from the JSONL filename prevents duplicate digestion on re-runs.

## structure

- Pipeline uses a two-pass model assignment: Haiku for exchange shape classification (cheap, structural) and Sonnet for moment detection and session transitions (expensive, semantic). This cost/quality split is a deliberate architectural choice, not an accident.
- Pipeline stages in order: log ingestion → shape classification (Haiku) → moment detection (Sonnet) → transition generation (Sonnet) → PostgreSQL storage
- The output data structure is a `SessionNarrative` interface — the canonical shape produced by the pipeline and stored in PostgreSQL

## constraint

- The Anthropic client must use `client.messages.stream()` (returning a MessageStream with `.finalMessage()`) — NOT `client.messages.create()` with `stream: true` — for large sessions. The latter returns a Stream object without `.finalMessage()` and times out on large inputs.
- The Postgres DB connection pool is never automatically closed. `closeDb()` must be explicitly called in CLI entry points (digest.ts) after pipeline completion — omitting this causes the process to hang indefinitely after a successful run.
- The `evidence` field in Pass2MomentSchema must be optional with a default — the LLM returns `undefined` for it, causing Zod validation crashes if required
- `candidateType` in the exchange classifier schema must coerce unknown values to null rather than failing validation — LLM output variation in this field was causing pipeline crashes
- Digest processes must run sequentially — parallel execution causes LLM API rate limiting and process hang issues

## decision

- Zod schemas in the digest pipeline are intentionally lenient: the `evidence` field in Pass2MomentSchema is optional with a default, and `candidateType` coerces unknown LLM-returned values to null rather than throwing. Do not tighten these schemas — LLM output variation is real and will cause crashes.
- The dedup guard uses the CC session UUID extracted from the JSONL filename as the `sourceHash` key — not a content hash. This prevents duplicate digestion on re-runs. The UUID is extracted in the orchestrator and written to the `sourceHash` column; existing sessions were backfilled.
- Relevance classification uses semantic moment-meaning ↔ topic-meaning matching, not file-overlap or import graph analysis. File-level signals were explicitly rejected because they miss transitive import impact and commit messages were rejected as fragile.

## behavior

- The postgres connection pool is never automatically closed — `closeDb()` must be explicitly called in digest.ts after `runPipeline()` completes, or the CLI process hangs indefinitely
- Claude Code conversation logs are the primary data source — they contain every Edit, Write, and Bash tool call with full context and reasoning, making them richer than raw git diffs
- Dedup guard uses the CC session UUID extracted from the JSONL filename as `sourceHash` — if a session with that UUID already exists in the DB, re-digestion is skipped. The `source_hash` column exists in schema and is now written on every store.
- The Anthropic LLM client must use `client.messages.stream()` (returning a MessageStream with `.finalMessage()`) rather than `client.messages.create()`. The non-streaming version times out for large sessions (1215+ events, 21+ chunks). Using `stream: true` with `messages.create()` returns a Stream object, not a message — that is also the wrong interface.
- The primary data source is Claude Code conversation logs (JSONL), not raw editor diffs or git history. Every Edit, Write, and Bash tool call is recorded with full context including the model's reasoning, making these logs semantically richer than git commits or file diffs.

## risk

- drizzle-kit migrate spawns a new Node process and does not inherit dotenv-loaded env vars — DATABASE_URL must be explicitly exported to the shell before running drizzle-kit as a subprocess
- Very large sessions (e.g. 4926 lines, 2096 events) hit Haiku's 64K token output limit in the exchange classifier — batched classification for large sessions is a known deferred problem
- Very large sessions (1215+ events) can hit Haiku's 64K token output limit when run through the exchange classifier in a single LLM call. Batched classification for large sessions is a known deferred problem — the current implementation will silently truncate or fail on sufficiently large inputs.

## interface

- The CLI entry point is `intent digest` — the primary command that triggers the full pipeline from log ingestion through storage
- The CLI entry point is `intent digest`. The authoritative spec for pipeline orchestration, model assignments, CLI UX, SessionNarrative interface, and Drizzle/Postgres storage schema lives at docs/superpowers/specs/2026-05-21-execution-memory-design.md.

## Files

- `docs/superpowers/specs/2026-05-21-execution-memory-design.md` — Authoritative design spec for pipeline orchestration, model assignments, CLI UX, SessionNarrative interface, and storage schema
- `src/cli/digest.ts` — CLI entry point for `intent digest` — calls closeDb() after pipeline completion
- `src/cli/digest.ts` — Digest CLI command — calls closeDb() after runPipeline() to prevent hang
- `src/llm/client.ts` — Anthropic client — must use client.messages.stream() for large sessions
- `src/llm/client.ts` — Anthropic LLM client — must use messages.stream() not messages.create() to avoid timeouts on large sessions
- `src/pipeline/classify-exchanges.ts` — Exchange classifier — candidateType schema made lenient
- `src/pipeline/classify-exchanges.ts` — Exchange classifier — Haiku-based semantic matching, has 64K token output ceiling for large sessions
- `src/pipeline/moments.ts` — Moment detection — Pass2MomentSchema with optional evidence field
- `src/pipeline/moments.ts` — Pass2MomentSchema with intentionally lenient evidence and candidateType fields to handle LLM output variation
- `src/pipeline/orchestrator.ts` — Pipeline orchestrator — dedup guard using CC session UUID from filename
- `src/pipeline/orchestrator.ts` — Pipeline orchestrator — extracts CC session UUID from JSONL filename for dedup guard, writes to sourceHash
- `src/storage/connection.ts` — DB connection pool — closeDb() must be called explicitly after pipeline
- `src/storage/connection.ts` — Exports closeDb() — must be called explicitly after pipeline completion to prevent process hang
- `docs/superpowers/specs/2026-05-21-execution-memory-design.md` — Full pipeline design including SessionNarrative interface, model assignments, and CLI commands

## Evidence

- May 21: The developer set out to build v2 of the project from scratch, explicitly leaving v1 behind as re... (3 moments)
- May 21: The developer set out to design the intent-ai project from scratch, starting with no existing cod... (13 moments)
- May 23: The session began with infrastructure failures — no DATABASE_URL, hanging processes, and Zod vali... (85 moments)

## Related

- [data model and schema](data-model-and-schema.md)
- [tech stack and architecture decisions](tech-stack-and-architecture-decisions.md)
- [Repo Brain pipeline](repo-brain-pipeline.md)
- [moment detection system](moment-detection-system.md)
