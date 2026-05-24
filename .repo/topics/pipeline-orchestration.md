# Pipeline Orchestration

The pipeline orchestrator is the central coordinator that transforms raw Claude Code conversation logs (JSONL files) into structured `SessionNarrative` outputs stored in Postgres. It runs a multi-pass LLM pipeline using a two-model strategy: Claude Haiku for cheap, fast shape classification and Claude Sonnet for quality-critical moment detection and transition writing. The orchestrator handles the full lifecycle — extracting the CC session UUID from the JSONL filename as a dedup key, running each pipeline pass in sequence, storing results via Drizzle ORM, and ensuring the Postgres connection is explicitly closed to prevent process hang. The CLI entry point is `intent digest` (src/cli/digest.ts), which calls `runPipeline()` then `closeDb()`. Robustness is a first-class concern: the Anthropic client must use streaming, Zod schemas for LLM output must be lenient, and the dedup guard prevents re-processing sessions on repeated runs.

## structure

- The canonical input source is Claude Code conversation logs (JSONL files), not git diffs or editor events. These logs contain every Edit, Write, and Bash tool call with full reasoning context, making them semantically richer than any alternative source.
- The pipeline uses a two-model strategy: Claude Haiku for shape classification (Pass 1 — cheap and fast) and Claude Sonnet for moment detection and transition writing (Pass 2+ — quality-critical). Do not swap these assignments without understanding the cost/quality tradeoff.
- The core output type is `SessionNarrative` — an interface covering detected moments, arcs, transitions, and agency fields — stored in Postgres via Drizzle ORM. The sessions table includes a `sourceHash` column used for dedup tracking.

## decision

- Zod schemas for LLM output must be lenient, not strict. The `evidence` field in Pass2MomentSchema is optional with a default (LLMs sometimes omit it), and `candidateType` coerces unknown enum values to null rather than throwing. Strict schemas cause runtime crashes on valid LLM responses that vary slightly from the expected format.
- The dedup guard uses the CC session UUID extracted from the JSONL filename as `sourceHash` — not a content hash. This UUID is stored in the sessions table and checked before processing to prevent duplicate digestion on re-runs. The choice of filename UUID (not content hash) is intentional.

## behavior

- The Postgres client is never automatically closed. `closeDb()` must be explicitly called in `src/cli/digest.ts` after `runPipeline()` completes, or the process will hang indefinitely even after all pipeline work is done.
- The Anthropic LLM client must use `client.messages.stream()` (returning a MessageStream, resolved via `.finalMessage()`) rather than `client.messages.create()`. The non-streaming version times out on large sessions (1215+ events). Using `stream: true` with `messages.create()` is also wrong — it returns a Stream object, not a message.

## risk

- `drizzle-kit migrate` spawns a new Node subprocess and does NOT inherit dotenv-loaded environment variables. `DATABASE_URL` must be exported to the shell environment before running migrations — loading it via `dotenv/config` in the parent process is insufficient.

## Files

- `src/cli/digest.ts` — CLI entry point for `intent digest` — calls runPipeline() then must call closeDb() to prevent process hang
- `src/llm/client.ts` — Anthropic LLM client — must use messages.stream() with .finalMessage(), not messages.create(), to avoid timeouts on large sessions
- `src/pipeline/moments.ts` — Pass 2 moment detection — Pass2MomentSchema must have evidence field as optional with default to handle LLM omissions
- `src/pipeline/orchestrator.ts` — Core pipeline coordinator — extracts CC session UUID for dedup, sequences pipeline passes, applies lenient candidateType Zod schema for exchange classification
- `src/storage/connection.ts` — Postgres connection management — exports closeDb() which must be called explicitly after pipeline completion
- `src/storage/schema.ts` — Drizzle ORM schema — sessions table includes sourceHash column for dedup guard keyed on CC session UUID

## Evidence

- May 21: The developer set out to build v2 of the project from scratch, explicitly leaving v1 behind as re... (3 moments)
- May 21: The developer set out to design the intent-ai project from scratch, starting with no existing cod... (13 moments)
- May 23: The session began with infrastructure failures — no DATABASE_URL, hanging processes, and Zod vali... (85 moments)
