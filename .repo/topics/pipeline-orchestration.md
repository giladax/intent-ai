# Pipeline Orchestration
> **area**
> The pipeline orchestrator is the central coordinator that transforms raw Claude Code conversation logs (JSONL files) into structured `SessionNarrative` outputs stored in Postgres. It runs a deliberate two-model, multi-pass LLM pipeline: Claude Haiku handles cheap, fast shape classification (structural pass), while Claude Sonnet handles quality-critical moment detection and transition writing (semantic pass). The orchestrator manages the full lifecycle — extracting the CC session UUID from the JSONL filename as a dedup key, running each pipeline pass in sequence, storing results via Drizzle ORM, and explicitly closing the Postgres connection to prevent process hang. The CLI entry point is `intent digest` (src/cli/digest.ts), which calls `runPipeline()` then `closeDb()`. Claude Code conversation logs are the primary data source because every Edit, Write, and Bash tool call is recorded with full context and reasoning, making them semantically richer than git history. Four hard-won robustness constraints govern the implementation: the Anthropic client must use streaming...
> [constraint] The Anthropic LLM client MUST use `client.messages.stream... · [constraint] Zod schemas for LLM output must be lenient: the `evidence... · [behavior] The Postgres connection is never automatically closed aft... · [structure] The pipeline runs end-to-end within a single process in f... · [decision] Claude Code conversation logs (JSONL) are the primary dat...

The pipeline orchestrator is the central coordinator that transforms raw Claude Code conversation logs (JSONL files) into structured `SessionNarrative` outputs stored in Postgres. It runs a deliberate two-model, multi-pass LLM pipeline: Claude Haiku handles cheap, fast shape classification (structural pass), while Claude Sonnet handles quality-critical moment detection and transition writing (semantic pass). The orchestrator manages the full lifecycle — extracting the CC session UUID from the JSONL filename as a dedup key, running each pipeline pass in sequence, storing results via Drizzle ORM, and explicitly closing the Postgres connection to prevent process hang. The CLI entry point is `intent digest` (src/cli/digest.ts), which calls `runPipeline()` then `closeDb()`. Claude Code conversation logs are the primary data source because every Edit, Write, and Bash tool call is recorded with full context and reasoning, making them semantically richer than git history. Four hard-won robustness constraints govern the implementation: the Anthropic client must use streaming (non-streaming times out on large sessions), Zod schemas for LLM output must be lenient (LLMs return unexpected values), the dedup guard prevents re-processing sessions on repeated runs, and digest processes must run sequentially (parallel runs cause LLM rate limiting and hangs).

## structure

- The pipeline uses a two-model strategy: Claude Haiku for shape classification (cheap, structural) and Claude Sonnet for moment detection and session transitions (expensive, semantic). This cost/quality split is intentional architecture, not an optimization to be collapsed.
- The pipeline runs end-to-end within a single process in four sequential stages: ingest conversation log → classify exchange shapes (Haiku) → detect moments (Sonnet) → write arc/transitions (Sonnet) → store to Postgres via Drizzle ORM.
- The canonical input source is Claude Code conversation logs (JSONL files), not git diffs or editor events. These logs contain every Edit, Write, and Bash tool call with full reasoning context, making them semantically richer than any alternative source.
- The pipeline uses a two-model strategy: Claude Haiku for shape classification (Pass 1 — cheap and fast) and Claude Sonnet for moment detection and transition writing (Pass 2+ — quality-critical). Do not swap these assignments without understanding the cost/quality tradeoff.
- The core output type is `SessionNarrative` — an interface covering detected moments, arcs, transitions, and agency fields — stored in Postgres via Drizzle ORM. The sessions table includes a `sourceHash` column used for dedup tracking.

## constraint

- The Anthropic LLM client MUST use `client.messages.stream()` with `.finalMessage()` — never `client.messages.create()`. The non-streaming version times out on large sessions (1215+ events). Passing `stream: true` to `messages.create()` is also wrong — it returns a Stream object, not a message.
- The Anthropic LLM client MUST use `client.messages.stream()` with `.finalMessage()` — never `client.messages.create()`. The non-streaming version times out on large sessions (1215+ events). Using `stream: true` with `messages.create()` returns a Stream object, not a message, and is also wrong.
- Zod schemas for LLM output must be lenient: the `evidence` field in Pass2MomentSchema must be optional with a default, and `candidateType` must coerce unknown values to null rather than failing validation. LLMs regularly return shapes that don't match strict enums.
- Zod schemas for LLM output must be lenient: the `evidence` field in Pass2MomentSchema must be optional with a default, and `candidateType` must coerce unknown enum values to null rather than throwing. LLMs routinely return unexpected values and strict schemas cause runtime crashes.

## decision

- The dedup guard uses the CC session UUID extracted from the JSONL filename as `sourceHash` — not a content hash of the file. This is stored in the sessions table and checked before processing to prevent duplicate digestion on repeated `intent digest` runs.
- The dedup guard uses the CC session UUID extracted from the JSONL filename as `sourceHash` (not a content hash) stored in the sessions table. This prevents duplicate digestion on re-runs and is the canonical identity for a session.
- Zod schemas for LLM output must be lenient, not strict. The `evidence` field in Pass2MomentSchema is optional with a default (LLMs sometimes omit it), and `candidateType` coerces unknown enum values to null rather than throwing. Strict schemas cause runtime crashes on valid LLM responses that vary slightly from the expected format.
- Claude Code conversation logs (JSONL) are the primary data source over git history or raw diffs — they contain every Edit, Write, and Bash tool call with full semantic context and developer reasoning intact.
- Two-model strategy is intentional cost/quality optimization: Haiku for structural shape classification (cheap, fast, low-stakes) and Sonnet for moment detection and transition writing (quality-critical, worth the cost).
- Digest processes must run sequentially, not in parallel. Parallel runs compete for the LLM API, causing rate limiting and indefinite hangs. This was discovered empirically and is a hard operational constraint.
- The dedup guard uses the CC session UUID extracted from the JSONL filename as `sourceHash` — not a content hash. This UUID is stored in the sessions table and checked before processing to prevent duplicate digestion on re-runs. The choice of filename UUID (not content hash) is intentional.

## behavior

- The Postgres connection is never automatically closed after pipeline completion. `closeDb()` must be explicitly called in `digest.ts` after `runPipeline()` completes, otherwise the CLI process hangs indefinitely.
- The Postgres client is never automatically closed. `closeDb()` must be explicitly called in `src/cli/digest.ts` after `runPipeline()` completes, or the process will hang indefinitely even after all pipeline work is done.
- The Anthropic LLM client must use `client.messages.stream()` (returning a MessageStream, resolved via `.finalMessage()`) rather than `client.messages.create()`. The non-streaming version times out on large sessions (1215+ events). Using `stream: true` with `messages.create()` is also wrong — it returns a Stream object, not a message.
- The entire pipeline runs end-to-end within a single process: ingest JSONL → shape classification → moment detection → transition extraction → storage → CLI output. There is no inter-process communication, message queue, or background worker.

## risk

- `closeDb()` must be called in digest.ts after `runPipeline()` completes. Without it, the postgres client stays open and the CLI process hangs indefinitely even after all pipeline work is done.
- Any new LLM response schema added to the pipeline is a potential Zod validation failure point. Always make fields optional with defaults and use `.catch(null)` or `.optional()` on enum fields — strict schemas will break on real LLM output.
- `drizzle-kit migrate` spawns a new Node subprocess and does NOT inherit dotenv-loaded environment variables. `DATABASE_URL` must be exported to the shell environment before running migrations — loading it via `dotenv/config` in the parent process is insufficient.

## interface

- The primary CLI entry point is `intent digest` (src/cli/digest.ts). It calls `runPipeline()` then `closeDb()`. The output contract is the `SessionNarrative` interface stored via Drizzle ORM into PostgreSQL.

## Files

- `docs/superpowers/specs/2026-05-21-execution-memory-design.md` — Architecture design doc defining pipeline stages, model assignments, and CLI commands
- `src/cli/digest.ts` — CLI entry point for `intent digest` — calls runPipeline() then must call closeDb() to prevent process hang
- `src/cli/digest.ts` — CLI entry point for `intent digest` command — calls runPipeline() then closeDb() to prevent process hang
- `src/cli/digest.ts` — Top-level CLI entry point for `intent digest` — calls runPipeline() then closeDb() to ensure clean process exit
- `src/llm/client.ts` — Anthropic LLM client — must use messages.stream() with .finalMessage(), never messages.create()
- `src/llm/client.ts` — Anthropic LLM client — must use messages.stream() with .finalMessage(), not messages.create(), to avoid timeouts on large sessions
- `src/pipeline/classify-exchanges.ts` — Shape classification pass using Haiku — candidateType Zod schema must coerce unknown enum values to null
- `src/pipeline/moments.ts` — Moment detection pass using Sonnet — Pass2MomentSchema evidence field must be optional with a default
- `src/pipeline/moments.ts` — Pass 2 moment detection — Pass2MomentSchema must have evidence field as optional with default to handle LLM omissions
- `src/pipeline/moments.ts` — Pass2MomentSchema definition — evidence field must be optional, candidateType must use lenient coercion
- `src/pipeline/orchestrator.ts` — Core pipeline coordinator — extracts CC session UUID for dedup, sequences pipeline passes, applies lenient candidateType Zod schema for exchange classification
- `src/pipeline/orchestrator.ts` — Core pipeline coordinator — extracts CC session UUID from JSONL filename for dedup, sequences all pipeline passes, writes sourceHash to storage
- `src/pipeline/orchestrator.ts` — Core pipeline coordinator — extracts session UUID from JSONL filename as sourceHash dedup key, runs all pipeline passes in sequence
- `src/storage/connection.ts` — Exports closeDb() — must be called after pipeline completes to prevent process hang
- `src/storage/connection.ts` — Postgres connection management — exports closeDb() which must be called explicitly after pipeline completion
- `src/storage/connection.ts` — Postgres connection pool — exports closeDb() that must be called after pipeline completes to prevent CLI hang
- `src/storage/schema.ts` — Drizzle ORM schema — sessions table includes sourceHash column for dedup guard keyed on CC session UUID

## Evidence

- May 21: The developer set out to build v2 of the project from scratch, explicitly leaving v1 behind as re... (3 moments)
- May 21: The developer set out to design the intent-ai project from scratch, starting with no existing cod... (13 moments)
- May 23: The session began with infrastructure failures — no DATABASE_URL, hanging processes, and Zod vali... (85 moments)
