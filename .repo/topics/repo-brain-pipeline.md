# Repo Brain pipeline

The Repo Brain is a versioned knowledge graph synthesized from session digests and committed as markdown to .repo/. It uses a mutation-based versioning doctrine where each `intent brain` CLI run creates a BrainVersion record, synthesizes topics with LLM-grounded evidence linked to specific moment UUIDs, persists to PostgreSQL, and exports agent-navigable markdown breadcrumbs. The synthesis function accepts generic evidence (not session-specific types) to remain source-agnostic for future PR-only analysis.

## structure

- Brain data model hierarchy: Category → Insight → Evidence → Sessions → Moments → Events, with user-configurable insight categories (feature, architecture, risk, etc.)

## constraint

- Brain mutations are never automatic — they are always human-gated; sessions view is private and separate from the brain, establishing a two-layer privacy model

## decision

- Brain state is stored in both PostgreSQL AND committed markdown files in .repo/ — so any coding agent on any branch can read brain state without needing the running system
- The brain synthesis function accepts generic `evidence` rather than `sessionDigest` — making the pipeline source-agnostic so PR-only brain updates can be added later without reworking the pipeline
- The insight category schema was adversarially reviewed before implementation — `flow` was rejected as redundant with `architecture`, `risk` and `gap` were merged as inseparable, and the litmus test 'Does knowing the category change what the agent does with the insight?' was established as the durable decision rule

## behavior

- Each `intent brain` run creates a BrainVersion record with a parent→child chain — the knowledge graph accumulates across sessions with traceable lineage, not overwritten
- Brain synthesis pre-computes a moment index with UUIDs and injects it into the prompt, requiring the LLM to cite specific moment IDs in evidence — this is the mechanism that grounds insights in verifiable sources

## risk

- The first synthesis output had broken evidence linking, confidence uniformity, and meta-observation leakage — these are structural correctness issues that required pre-computation fixes, not prompt tweaks

## interface

- The CLI command `intent brain` triggers brain synthesis and creates a BrainVersion; `brain-export` generates .repo/ markdown files from the brain DB

## Files

- `docs/plans/2026-05-23-repo-brain.md` — Implementation plan for the Repo Brain
- `docs/superpowers/specs/2026-05-23-repo-brain-design.md` — Design spec for the Repo Brain feature
- `.repo/brain.md` — Agent-navigable brain index committed to repo
- `.repo/topics/moment-detection.md` — Example topic breadcrumb file in .repo/
- `src/adapters/types.ts` — Brain types definition — BrainVersion, Topic, Insight, Evidence
- `src/brain/generate-markdown.ts` — Exports brain DB state to .repo/ markdown files for agent navigation
- `src/cli/index.ts` — CLI wiring — brain and brain-export commands
- `src/llm/prompts/brain-synthesis.ts` — LLM prompt for brain synthesis — injects moment index, requires UUID citations
- `src/pipeline/brain-synthesis.ts` — Core synthesis pipeline — LLM synthesis with moment-index evidence linking, DB storage, version chain
- `src/storage/schema.ts` — Brain DB tables — topics, insights, evidence, brain_versions

## Evidence

- May 23: The session began with infrastructure failures — no DATABASE_URL, hanging processes, and Zod vali... (85 moments)

## Related

- [data model and schema](data-model-and-schema.md)
- [digestion pipeline](digestion-pipeline.md)
