# Core Pipeline & Brain

> Children: [Static Repo Index](static-repo-index.md)

The Core Pipeline & Brain is the central processing system responsible for transforming raw codebase artifacts into a structured, queryable 'brain' — a synthesized knowledge representation that enables intelligent developer assistance. The pipeline ingests source files, extracts semantic meaning, and produces versioned brain snapshots that downstream consumers (such as chat, search, and code generation tools) rely on. It exists because raw source code is not directly useful for context-aware AI assistance; the pipeline bridges the gap between static repository content and dynamic, queryable knowledge. The brain itself is the output artifact: a distilled, indexed representation of the codebase's structure, intent, and relationships. Child specs cover Brain Synthesis Quality (how well the brain captures meaning), Brain Versioning (how brain snapshots are managed over time), and Static Repo Index (the foundational file-level index the pipeline builds upon).

## structure

- Brain state lives in two synchronized stores: Postgres (brain_versions, brain_topics, brain_insights, brain_evidence tables) and committed .repo/ markdown files. Postgres is the source of truth; markdowns are derived exports that allow agents on any branch to read brain state without database access.
- The moment schema includes two critical fields added after adversarial review: an `agency` field (developer vs AI) and an `execution` moment type. The `execution` type specifically addresses the 'boring middle' problem — sessions dominated by routine implementation work that have no dramatic inflection points but still need representation in the output.
- The pipeline uses a two-model strategy: Claude Haiku for shape classification (cheap, structural) and Claude Sonnet for moment detection and session transitions (expensive, semantic). This cost/quality split is intentional architecture, not an optimization to be collapsed.
- The pipeline operates as a staged transformation: raw repo files feed into the Static Repo Index, which feeds into synthesis, which produces a versioned Brain artifact — each stage has a distinct responsibility and output contract.

## constraint

- The Anthropic LLM client MUST use `client.messages.stream()` with `.finalMessage()` — never `client.messages.create()`. The non-streaming version times out on large sessions (1215+ events). Passing `stream: true` to `messages.create()` is also wrong — it returns a Stream object, not a message.
- Zod schemas for LLM output must be lenient: the `evidence` field in Pass2MomentSchema must be optional with a default, and `candidateType` must coerce unknown values to null rather than failing validation. LLMs regularly return shapes that don't match strict enums.
- Brain insight evidence MUST cite specific moment UUIDs — never positional indices. The synthesis prompt pre-computes a moment index with IDs and the output schema requires UUID citations. Positional indices are structurally incorrect and will produce evidence links that drift as moment order changes.

## decision

- Moment detection is the 'crown jewel' of v1 — it receives maximum prompt engineering investment and the quality bar is that output must feel like 'this system actually understood what I was doing'. Do not cut corners here in favor of speed or simplicity.
- The dedup guard uses the CC session UUID extracted from the JSONL filename as `sourceHash` — not a content hash of the file. This is stored in the sessions table and checked before processing to prevent duplicate digestion on repeated `intent digest` runs.
- Digest processes must run sequentially, not in parallel. Parallel runs compete for the LLM API, causing rate limiting and indefinite hangs. This was discovered empirically and is a hard operational constraint.
- Eval-driven development is a first-class architectural requirement from v1, not a testing afterthought. Fixtures, adversarial inputs, and measurable quality gates must be built alongside the detection logic itself — mirroring the same EDD pattern used for brain synthesis evaluation.
- The category set was deliberately minimized through adversarial review: `flow` was dropped as redundant with `structure`/`architecture`, and `risk`/`gap` were merged because they are inseparable in practice. Any future category proposal must pass the litmus test: 'Does knowing this category change what the agent *does* with the insight?'
- Relevance classification — assigning insights to topics — uses semantic moment-meaning ↔ topic-meaning matching, not file-overlap or import-graph matching. File diffs are explicitly rejected as signals because they miss transitive import impact and are poor proxies for semantic understanding.
- The synthesis pipeline accepts generic `evidence` objects rather than `sessionDigest` types — this is a deliberate architectural choice so that PR-based or other non-session evidence sources can feed the same pipeline without any pipeline changes.

## behavior

- Each `intent brain` CLI run creates a new BrainVersion record with a parent pointer to the previous version, forming a parent→child chain. The brain versions per run — not per session or per commit. Version chain integrity is verifiable: v1 has no parent, v2 points to v1, and topics accumulate across versions.
- The primary data source for moment detection is the Claude Code conversation log (JSONL), not git history, raw diffs, or editor events. Every Edit, Write, and Bash tool call is recorded with full context including the AI's reasoning chain, making the conversation log semantically richer than any downstream artifact like commits.

## risk

- `closeDb()` must be called in digest.ts after `runPipeline()` completes. Without it, the postgres client stays open and the CLI process hangs indefinitely even after all pipeline work is done.
- `drizzle-kit migrate` spawns a new Node subprocess and does NOT inherit dotenv-loaded environment variables. `DATABASE_URL` must be exported to the shell environment before running migrations — loading it via `dotenv/config` in the parent process is insufficient.

## interface

- The Brain exposes a stable read interface to downstream consumers; the pipeline owns the write side exclusively — no consumer should write to or mutate the Brain directly.

## Files

- `.repo/brain.md`
- `.repo/topics/moment-detection.md`
- `docs/superpowers/specs/2026-05-21-execution-memory-design.md`
- `docs/superpowers/specs/2026-05-21-execution-memory-design.md`
- `src/adapters/types.ts`
- `src/brain/generate-markdown.ts`
- `src/cli/digest.ts`
- `src/cli/index.ts`
- `src/db/schema.ts`
- `src/llm/client.ts`
- `src/llm/prompts/brain-synthesis.ts`
- `src/pipeline/brain-synthesis.ts`
- `src/pipeline/classify-exchanges.ts`
- `src/pipeline/index.ts`
- `src/pipeline/moments.ts`
- `src/pipeline/orchestrator.ts`
- `src/storage/connection.ts`
- `src/storage/schema.ts`
- _from [Static Repo Index](static-repo-index.md):_
  - `.repo/`

## Sessions

- May 21: The developer set out to build v2 of the project from scratch, explicitly leaving v1 behind as re... (3 moments)
- May 25: The developer set out to implement insight deduplication using Eval-Driven Development, requiring... (7 moments)
- May 21: The developer set out to design the intent-ai project from scratch, starting with no existing cod... (13 moments)
- May 23: The session began with infrastructure failures — no DATABASE_URL, hanging processes, and Zod vali... (85 moments)
