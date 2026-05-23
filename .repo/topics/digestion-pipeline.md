# digestion pipeline

The intent-ai digestion pipeline is a sequential, single-process pipeline triggered via `intent digest`. This session resolved multiple robustness issues: the Anthropic streaming API must use `client.messages.stream()` (not `client.messages.create()` with `stream: true`) for large sessions to avoid timeouts; Zod schemas for `evidence` and `candidateType` must be lenient to handle LLM output variation; the postgres connection must be explicitly closed after pipeline completion to prevent process hang; and a dedup guard using the CC session UUID from the filename prevents duplicate digestion.

## structure

- Pipeline stages in order: log ingestion → shape classification (Haiku) → moment detection (Sonnet) → transition generation (Sonnet) → PostgreSQL storage
- The output data structure is a `SessionNarrative` interface — the canonical shape produced by the pipeline and stored in PostgreSQL

## constraint

- The Anthropic client must use `client.messages.stream()` (returning a MessageStream with `.finalMessage()`) — NOT `client.messages.create()` with `stream: true` — for large sessions. The latter returns a Stream object without `.finalMessage()` and times out on large inputs.
- The `evidence` field in Pass2MomentSchema must be optional with a default — the LLM returns `undefined` for it, causing Zod validation crashes if required
- `candidateType` in the exchange classifier schema must coerce unknown values to null rather than failing validation — LLM output variation in this field was causing pipeline crashes
- Digest processes must run sequentially — parallel execution causes LLM API rate limiting and process hang issues

## behavior

- The postgres connection pool is never automatically closed — `closeDb()` must be explicitly called in digest.ts after `runPipeline()` completes, or the CLI process hangs indefinitely
- Claude Code conversation logs are the primary data source — they contain every Edit, Write, and Bash tool call with full context and reasoning, making them richer than raw git diffs
- Dedup guard uses the CC session UUID extracted from the JSONL filename as `sourceHash` — if a session with that UUID already exists in the DB, re-digestion is skipped. The `source_hash` column exists in schema and is now written on every store.

## risk

- drizzle-kit migrate spawns a new Node process and does not inherit dotenv-loaded env vars — DATABASE_URL must be explicitly exported to the shell before running drizzle-kit as a subprocess
- Very large sessions (e.g. 4926 lines, 2096 events) hit Haiku's 64K token output limit in the exchange classifier — batched classification for large sessions is a known deferred problem

## interface

- The CLI entry point is `intent digest` — the primary command that triggers the full pipeline from log ingestion through storage

## Files

- `src/cli/digest.ts` — Digest CLI command — calls closeDb() after runPipeline() to prevent hang
- `src/llm/client.ts` — Anthropic client — must use client.messages.stream() for large sessions
- `src/pipeline/classify-exchanges.ts` — Exchange classifier — candidateType schema made lenient
- `src/pipeline/moments.ts` — Moment detection — Pass2MomentSchema with optional evidence field
- `src/pipeline/orchestrator.ts` — Pipeline orchestrator — dedup guard using CC session UUID from filename
- `src/storage/connection.ts` — DB connection pool — closeDb() must be called explicitly after pipeline
- `docs/superpowers/specs/2026-05-21-execution-memory-design.md` — Full pipeline design including SessionNarrative interface, model assignments, and CLI commands

## Evidence

- May 21: The developer set out to design the intent-ai project from scratch, starting with no existing cod... (13 moments)
- May 23: The session began with infrastructure failures — no DATABASE_URL, hanging processes, and Zod vali... (85 moments)

## Related

- [tech stack and architecture decisions](tech-stack-and-architecture-decisions.md)
- [moment detection system](moment-detection-system.md)
- [data model and schema](data-model-and-schema.md)
- [Repo Brain pipeline](repo-brain-pipeline.md)
