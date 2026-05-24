# Moment Detection & Evaluation

> Parent: [Pipeline Orchestration](pipeline-orchestration.md)

Moment Detection & Evaluation is the semantic core of the pipeline — the stage responsible for identifying which exchanges in a Claude Code conversation session are worth preserving as structured 'moments' in the final SessionNarrative. It runs as the second major pass in the pipeline, executed by Claude Sonnet (the quality-critical model) after Claude Haiku has already classified the structural shape of the session. A 'moment' represents a meaningful unit of developer activity: a decision, a discovery, a problem solved, a constraint established, or a direction changed. The detection logic must distinguish signal from noise in raw JSONL conversation logs, where the majority of tool calls and exchanges are routine scaffolding. Because Claude Code logs include full tool call context and reasoning (Edit, Write, Bash), the semantic pass can evaluate not just what happened but why — making moment quality substantially higher than what git history alone could provide. Zod schemas governing LLM output from this pass are intentionally lenient to handle the reality that LLMs return unexpected field values or structures; strict schemas would cause silent failures or crashes on valid but slightly malformed responses.

## structure

- The moment schema includes two critical fields added after adversarial review: an `agency` field (developer vs AI) and an `execution` moment type. The `execution` type specifically addresses the 'boring middle' problem — sessions dominated by routine implementation work that have no dramatic inflection points but still need representation in the output.
- The moment schema includes two critical fields added after adversarial review: an `agency` field (distinguishing whether the developer or the AI drove the action) and an `execution` moment type (capturing routine work sessions that have no inflection points but still need useful output).
- Moment detection runs as the second pass, after Claude Haiku's structural classification pass has already shaped the session — meaning the semantic pass can use structural metadata as context rather than re-deriving it from raw JSONL.
- Moment Detection operates as a stage within the Pipeline & Execution parent system — it consumes raw session activity (tool calls, edits, conversation turns) and produces structured moment objects that downstream components (storage, retrieval, summarization) consume. The moment schema is the contract between this stage and everything downstream.
- The eval framework is a peer component to the pipeline orchestrator — it consumes the same pipeline passes (structural and semantic) but drives them with fixture inputs rather than live JSONL files, comparing outputs against expected results.

## constraint

- Eval-driven development is a hard architectural requirement from v1, not a future testing phase. Fixtures, adversarial inputs, and measurable quality gates must be built alongside the detection logic itself — shipping moment detection without evals is not considered done.
- The Anthropic client must use streaming mode when calling Sonnet for moment detection — non-streaming requests time out on large sessions, making streaming a hard operational requirement, not a preference.
- Zod schemas for LLM output in the moment detection pass must be lenient (use .optional(), .catch(), or loose union types) — strict schemas will cause failures when Sonnet returns valid but slightly unexpected structures, which happens regularly in production.
- Moment Detection runs on Claude Sonnet (not Haiku) as a hard constraint within the two-model pipeline strategy. Haiku handles cheap structural classification; Sonnet handles quality-critical semantic extraction. Swapping models here would directly degrade the quality bar the system is designed around.
- Quality gates must be quantitative and measurable — vague subjective assessments of output quality are insufficient. The framework requires defined thresholds (e.g., precision/recall on moment detection) that can be checked programmatically.

## decision

- Moment detection is the 'crown jewel' of v1 — it receives maximum prompt engineering investment and the quality bar is that output must feel like 'this system actually understood what I was doing'. Do not cut corners here in favor of speed or simplicity.
- Moment Detection is the highest-priority component in the entire v1 system — it receives maximum design and prompt engineering effort. The quality bar is not 'technically correct' but 'feels like the system understood what I was doing'. Do not cut corners here to ship faster.
- Moment Detection is the 'crown jewel' of v1 and receives disproportionate design and prompt engineering investment. The explicit quality bar is: output must feel like 'this system actually understood what I was doing' — not just syntactically correct JSON.
- Eval-driven development is a first-class architectural requirement from v1, not a testing afterthought. Fixtures, adversarial inputs, and measurable quality gates must be built alongside the detection logic itself — mirroring the same EDD pattern used for brain synthesis evaluation.
- The moment schema includes an `agency` field with values `ai` vs `developer` to distinguish who drove each moment. This is a required schema field, not optional metadata — it was added after adversarial review identified its absence as a concrete design gap.
- Relevance matching between moments and downstream consumers (e.g., brain topics) uses semantic meaning-to-meaning matching, NOT file-overlap or import-graph analysis. Files are poor semantic signals and miss transitive import impact — this is a hard architectural decision, not a preference.
- Moment detection uses Claude Sonnet (not Haiku) as part of the pipeline's two-model strategy. Haiku handles cheap shape classification upstream; Sonnet is reserved for quality-critical work including moment detection and transition writing. Do not swap Sonnet for Haiku here to save cost — the quality differential is the entire point.
- The moment schema includes an `execution` moment type specifically to handle the 'boring middle' problem — sessions where 80% of activity has no inflection points. Without this type, those sessions produce empty or useless output. Every session must produce at least some moment output.
- The primary data source for moment detection is the Claude Code JSONL conversation log, not git history or raw diffs. Every Edit, Write, and Bash tool call is recorded with the AI's full reasoning context, making the log semantically richer than any downstream artifact — this is why the pipeline reads JSONL directly rather than inspecting git.
- Eval-driven development is a first-class architectural requirement for Moment Detection, not an afterthought. Fixtures, adversarial inputs, and measurable quality gates must exist from the start — the adversarial review that produced the 7 schema fixes is the template for ongoing quality assurance.
- Evals are a v1 deliverable, not a future iteration — this means eval infrastructure (fixtures, runners, quality gates) must be built in parallel with the pipeline itself, not after it stabilizes.
- Claude Sonnet is used for moment detection (not Haiku) because this is the quality-critical pass — the moments identified here become the permanent record in the SessionNarrative, so accuracy and semantic depth justify the higher cost.

## behavior

- The primary data source for moment detection is the Claude Code conversation log (JSONL), not git history, raw diffs, or editor events. Every Edit, Write, and Bash tool call is recorded with full context including the AI's reasoning chain, making the conversation log semantically richer than any downstream artifact like commits.
- The `execution` moment type solves the 'boring middle' problem: sessions where 80% of activity is routine implementation work with no inflection points must still produce useful, non-empty output. Without this type, those sessions would yield zero moments and be useless as memory.
- Moment detection operates on Claude Code JSONL logs where every Edit, Write, and Bash tool call is recorded with full context and reasoning — this richness is what enables semantic evaluation of developer intent, not just surface-level action classification.
- The dedup guard upstream of moment detection prevents re-processing already-digested sessions, meaning moment detection will not run again for a session UUID that already has a stored SessionNarrative — repeated CLI invocations are safe.
- Adversarial inputs are an explicit part of the eval suite — the framework must include edge-case JSONL fixtures (e.g., sessions with no clear moments, extremely long sessions, malformed tool calls) to validate pipeline robustness beyond happy-path scenarios.

## risk

- Two known failure modes require explicit prompt engineering attention: (1) missing causal links between moments — the prompt must encourage the model to surface how one moment caused or enabled another; (2) the 'boring middle' — sessions with no dramatic inflection points must still produce useful `execution` moments rather than sparse or empty output.
- Seven design gaps were identified via adversarial review — including missing causal links between moments, no structured agency field, and the boring middle problem. All were resolved in the spec, but they represent fragile areas: if the schema drifts away from these fixes (e.g., agency field dropped, execution type removed), the system silently regresses to a weaker design.
- Very large sessions (1215+ events, ~4926 lines) can hit model token output limits in upstream pipeline stages (the exchange classifier hit Haiku's 64K token ceiling). Moment detection must be designed with awareness that its input — the classified exchanges — may be incomplete or truncated for large sessions until batched classification is implemented.
- Running multiple moment detection passes in parallel causes LLM rate limiting and process hangs — digest operations must be sequenced, not parallelized, even when processing multiple sessions.
- Three known fragile areas identified via adversarial review: (1) missing causal links between moments — moments are currently isolated events with no explicit cause-effect chain; (2) sessions with no inflection points producing empty output — partially mitigated by the `execution` type but implementation must honor it; (3) the `agency` field was absent pre-review — any refactor that drops it reintroduces a known gap.
- Without the eval framework, prompt changes to the Haiku classification pass or Sonnet moment detection pass have no safety net — a regression in LLM output quality would be invisible until a developer manually inspects output. This is the primary risk the framework mitigates.

## interface

- Moment detection outputs structured moment objects that are stored via Drizzle ORM into Postgres — the output schema must remain compatible with the Drizzle table definitions, and any schema changes require coordinated migration.

## Files

- `docs/superpowers/specs/2026-05-21-execution-memory-design.md`
- `docs/superpowers/specs/2026-05-21-execution-memory-design.md`
- `src/cli/digest.ts`
- `src/db/schema.ts`
- `src/pipeline/brain-synthesis.ts`
- `src/pipeline/classify-exchanges.ts`
- `src/pipeline/index.ts`
- `src/pipeline/moments.ts`

## Sessions

- May 21: The developer set out to build v2 of the project from scratch, explicitly leaving v1 behind as re... (3 moments)
- May 21: The developer set out to design the intent-ai project from scratch, starting with no existing cod... (13 moments)
- May 23: The session began with infrastructure failures — no DATABASE_URL, hanging processes, and Zod vali... (85 moments)
