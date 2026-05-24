# Moment Detection

Moment Detection is the core intelligence layer of the Intent AI pipeline — the subsystem responsible for analyzing raw session activity and extracting semantically meaningful inflection points called 'moments'. It exists because raw tool calls, file edits, and conversation turns are too granular and noisy to be useful as memory; moments are the compressed, meaningful units that make session history actually retrievable and understandable. The system must identify when something significant happened (a decision, a discovery, a pivot, a completion), who or what drove it (developer vs AI, captured in the `agency` field), and what type of event it represents — including the `execution` type specifically designed to handle sessions where 80% of activity is routine work with no inflection points, ensuring those sessions still produce useful output rather than empty results. Moment Detection sits within the Pipeline & Execution parent system as the highest-value, highest-effort component: it is explicitly the 'crown jewel' of v1, with maximum prompt engineering investment and a quality bar defined as output that feels like 'this system actually understood what I was doing'. Eval-driven development is baked in from the start — fixtures, adversarial inputs, and measurable quality gates are first-class architectural requirements, not afterthoughts.

## structure

- Moment Detection operates as a stage within the Pipeline & Execution parent system — it consumes raw session activity (tool calls, edits, conversation turns) and produces structured moment objects that downstream components (storage, retrieval, summarization) consume. The moment schema is the contract between this stage and everything downstream.

## constraint

- Eval-driven development is a hard architectural requirement from v1, not a future testing phase. Fixtures, adversarial inputs, and measurable quality gates must be built alongside the detection logic itself — shipping moment detection without evals is not considered done.

## decision

- Moment Detection is the highest-priority component in the entire v1 system — it receives maximum design and prompt engineering effort. The quality bar is not 'technically correct' but 'feels like the system understood what I was doing'. Do not cut corners here to ship faster.
- The moment schema includes an `agency` field with values `ai` vs `developer` to distinguish who drove each moment. This is a required schema field, not optional metadata — it was added after adversarial review identified its absence as a concrete design gap.
- The moment schema includes an `execution` moment type specifically to handle the 'boring middle' problem — sessions where 80% of activity has no inflection points. Without this type, those sessions produce empty or useless output. Every session must produce at least some moment output.

## risk

- Three known fragile areas identified via adversarial review: (1) missing causal links between moments — moments are currently isolated events with no explicit cause-effect chain; (2) sessions with no inflection points producing empty output — partially mitigated by the `execution` type but implementation must honor it; (3) the `agency` field was absent pre-review — any refactor that drops it reintroduces a known gap.

## Files

- `docs/superpowers/specs/2026-05-21-execution-memory-design.md` — Primary design spec containing the moment schema definition including the agency field, execution moment type, and eval requirements — the authoritative reference for what a moment is and what the detection system must produce.

## Evidence

- May 21: The developer set out to build v2 of the project from scratch, explicitly leaving v1 behind as re... (3 moments)
- May 21: The developer set out to design the intent-ai project from scratch, starting with no existing cod... (13 moments)
- May 23: The session began with infrastructure failures — no DATABASE_URL, hanging processes, and Zod vali... (85 moments)
