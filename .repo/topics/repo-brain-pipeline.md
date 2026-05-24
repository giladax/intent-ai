# Repo Brain pipeline

The Repo Brain is a versioned, LLM-synthesized knowledge graph that distills session digests into durable, agent-navigable insights about a codebase. It exists to solve a specific problem: coding agents on any branch need to understand accumulated project knowledge without requiring the running system. The pipeline works in three stages — (1) a `intent brain` CLI run creates a BrainVersion record, processes session evidence sequentially, and calls the synthesis LLM with a pre-computed moment index that forces UUID-grounded citations; (2) synthesized topics and insights are persisted to PostgreSQL for live queries; (3) `brain-export` commits markdown breadcrumbs under `.repo/` so any agent can read brain state from the filesystem alone. Brain mutations are always human-gated — sessions are private/personal, the brain is shared curated knowledge, and the bridge between sessions and topics must be visible in the UI. The synthesis function accepts generic `evidence` (not session-specific types), making the pipeline source-agnostic so future PR-only or agentic analysis can feed the same pipeline without modification.

## structure

- Every `intent brain` CLI run creates a new `BrainVersion` record forming a parent→child version chain. Sessions are processed sequentially and topics accumulate across runs — v1 has no parent, v2 points to v1, and so on.
- The brain synthesis function accepts generic `evidence` (not `sessionDigest`) as its input type — this is a deliberate architectural constraint that makes the pipeline source-agnostic, allowing future PR-only or agentic analysis to feed the same pipeline without changes.
- Brain data model hierarchy: Category → Insight → Evidence → Sessions → Moments → Events, with user-configurable insight categories (feature, architecture, risk, etc.)

## constraint

- Brain mutations are NEVER automatic — they are always human-gated. Sessions are private/personal data; the brain is shared curated knowledge. The UI must show which user sessions contributed to each topic (the session→topic bridge) in the topic detail panel.
- Brain mutations are never automatic — they are always human-gated; sessions view is private and separate from the brain, establishing a two-layer privacy model

## decision

- The brain synthesis function accepts generic `evidence` rather than `sessionDigest` — making the pipeline source-agnostic so PR-only brain updates can be added later without reworking the pipeline
- Brain state is stored in both PostgreSQL AND committed markdown files in .repo/ — so any coding agent on any branch can read brain state without needing the running system
- Brain state is stored in BOTH PostgreSQL (for live queries) AND committed markdown files under `.repo/` — the dual-storage approach is intentional so coding agents on any branch can read brain state without needing the running system.
- The insight category schema was adversarially reviewed before implementation — `flow` was rejected as redundant with `architecture`, `risk` and `gap` were merged as inseparable, and the litmus test 'Does knowing the category change what the agent does with the insight?' was established as the durable decision rule
- Insight categories were redesigned after adversarial review using a strict litmus test: 'Does knowing the category change what the agent *does* with the insight?' Categories that failed this test were dropped or merged — `flow` was dropped as redundant with architecture, `risk` and `gap` were merged.

## behavior

- Each `intent brain` run creates a BrainVersion record with a parent→child chain — the knowledge graph accumulates across sessions with traceable lineage, not overwritten
- The brain synthesis LLM prompt pre-computes a moment index with UUIDs and injects it into the prompt context, requiring the LLM to cite specific moment UUIDs in evidence fields. This pre-computation step — not prompt wording — is what grounds insights in traceable evidence.
- Brain synthesis pre-computes a moment index with UUIDs and injects it into the prompt, requiring the LLM to cite specific moment IDs in evidence — this is the mechanism that grounds insights in verifiable sources

## risk

- The first synthesis output had broken evidence linking, confidence uniformity, and meta-observation leakage — these are structural correctness issues that required pre-computation fixes, not prompt tweaks

## interface

- The CLI command `intent brain` triggers brain synthesis and creates a BrainVersion; `brain-export` generates .repo/ markdown files from the brain DB

## Files

- `docs/plans/2026-05-23-repo-brain.md` — Implementation plan for the Repo Brain
- `docs/superpowers/specs/2026-05-23-repo-brain-design.md` — Design spec for the Repo Brain feature
- `.repo/brain.md` — Agent-navigable brain index committed to repo
- `.repo/brain.md` — Committed brain overview markdown — the primary agent-readable entry point for brain state without a running system
- `.repo/topics/moment-detection.md` — Example per-topic brain breadcrumb file — illustrates the structure of committed topic-level markdown for agent navigation
- `.repo/topics/moment-detection.md` — Example topic breadcrumb file in .repo/
- `src/adapters/types.ts` — Brain types definition — BrainVersion, Topic, Insight, Evidence
- `src/adapters/types.ts` — Shared brain types across the pipeline including the generic evidence type that enforces source-agnosticism
- `src/brain/generate-markdown.ts` — Exports brain DB state to .repo/ markdown files for agent navigation
- `src/brain/generate-markdown.ts` — Exports synthesized brain to .repo/ markdown files for agent navigation without requiring the running system
- `src/cli/index.ts` — CLI entry point — wires createBrainVersion into the `intent brain` run, orchestrates the full pipeline execution
- `src/cli/index.ts` — CLI wiring — brain and brain-export commands
- `src/llm/prompts/brain-synthesis.ts` — Brain synthesis LLM prompt — pre-computes and injects moment index with UUIDs, requires LLM to cite specific moment UUIDs in all evidence fields
- `src/llm/prompts/brain-synthesis.ts` — LLM prompt for brain synthesis — injects moment index, requires UUID citations
- `src/pipeline/brain-synthesis.ts` — Core brain synthesis pipeline — evidence-source-agnostic, creates BrainVersion records, processes evidence sequentially, calls LLM with moment index injection
- `src/pipeline/brain-synthesis.ts` — Core synthesis pipeline — LLM synthesis with moment-index evidence linking, DB storage, version chain
- `src/storage/schema.ts` — Brain DB tables — topics, insights, evidence, brain_versions
- `src/storage/schema.ts` — Defines brain tables: topics, insights, evidence refs, and brain versions — the PostgreSQL persistence layer

## Evidence

- May 21: The developer set out to build v2 of the project from scratch, explicitly leaving v1 behind as re... (3 moments)
- May 21: The developer set out to design the intent-ai project from scratch, starting with no existing cod... (13 moments)
- May 23: The session began with infrastructure failures — no DATABASE_URL, hanging processes, and Zod vali... (85 moments)

## Related

- [data model and schema](data-model-and-schema.md)
- [digestion pipeline](digestion-pipeline.md)
