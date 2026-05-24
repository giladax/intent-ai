# Brain Versioning
> **area**
> Brain Versioning is the mechanism by which the Repo Brain accumulates and tracks knowledge over time. Each invocation of `intent brain` creates a new BrainVersion record in Postgres with a parent pointer to the previous version, forming a traceable chain (v1 → v2 → v3 ...). This is not a session-to-commit mapping — a single brain run synthesizes evidence from one or more sessions and appends new topics/insights to the graph, with the version record acting as a snapshot of the graph state at that point. The brain state is persisted in two complementary stores: Postgres tables (brain_versions, brain_topics, brain_insights, brain_evidence, topic_sessions) for structured querying, and committed markdown files under .repo/ for agent-readable navigation without infrastructure. The synthesis pipeline is deliberately evidence-source-agnostic — it accepts generic evidence objects, meaning PR-based or other non-session sources can feed the same pipeline without modification. Insight quality is enforced structurally: the synthesis prompt pre-computes...
> [decision] Brain state is stored in BOTH Postgres AND committed mark... · [structure] The brain synthesis pipeline flows in a fixed sequence: s... · [behavior] Brain synthesis requires a pre-computed moment index (UUI... · [constraint] Brain mutations are never automatic — they are always hum... · [decision] The brain synthesis function accepts generic `evidence` o...

Brain Versioning is the mechanism by which the Repo Brain accumulates and tracks knowledge over time. Each invocation of `intent brain` creates a new BrainVersion record in Postgres with a parent pointer to the previous version, forming a traceable chain (v1 → v2 → v3 ...). This is not a session-to-commit mapping — a single brain run synthesizes evidence from one or more sessions and appends new topics/insights to the graph, with the version record acting as a snapshot of the graph state at that point. The brain state is persisted in two complementary stores: Postgres tables (brain_versions, brain_topics, brain_insights, brain_evidence, topic_sessions) for structured querying, and committed markdown files under .repo/ for agent-readable navigation without infrastructure. The synthesis pipeline is deliberately evidence-source-agnostic — it accepts generic evidence objects, meaning PR-based or other non-session sources can feed the same pipeline without modification. Insight quality is enforced structurally: the synthesis prompt pre-computes a moment index and requires UUID citations in the output schema, preventing positional index drift. Brain mutations are always human-gated — the brain is shared curated knowledge, distinct from the private sessions view. The insight categories themselves are covered in the child spec 'Brain Insight Categories'.

## structure

- Brain state lives in two synchronized stores: Postgres (brain_versions, brain_topics, brain_insights, brain_evidence tables) and committed .repo/ markdown files. Postgres is the source of truth; markdowns are derived exports that allow agents on any branch to read brain state without database access.
- Brain state lives in two complementary stores: Postgres tables (brain_versions, brain_topics, brain_insights, brain_evidence, topic_sessions) for structured querying, and committed markdown files under .repo/ for agent-readable navigation without any infrastructure dependency. Both must stay in sync after each brain run.
- The brain synthesis pipeline flows in a fixed sequence: session digests → brain-synthesis.ts (LLM call with pre-computed moment index) → storeTopics() (DB persistence with merge logic) → createBrainVersion() (version chain record with parent pointer) → generate-markdown.ts (.repo/ export). Each `intent brain` run creates exactly one new BrainVersion pointing to its parent.
- The markdown generation step is downstream of brain synthesis — it consumes the already-stored DB state rather than re-running LLM synthesis. The two steps are separate CLI commands (`brain-synthesis` then `brain-export`), keeping generation stateless and idempotent.

## constraint

- Brain insight evidence MUST cite specific moment UUIDs — never positional indices. The synthesis prompt pre-computes a moment index with IDs and the output schema requires UUID citations. Positional indices are structurally incorrect and will produce evidence links that drift as moment order changes.
- Insight categories must pass the litmus test: 'Does knowing the category change what the agent *does* with the insight?' Categories that fail this test are rejected. Specifically: `flow` was removed as redundant with `architecture`, and `risk`/`gap` were merged because they are inseparable in practice. Do not re-introduce these without re-running the adversarial review gate.
- Brain mutations are never automatic — they are always human-gated via explicit `intent brain` invocation. The sessions view is private/personal; the brain is shared curated knowledge. The topic detail panel must show which user sessions contributed to each topic, making the bridge between private sessions and shared brain visible.
- Each per-topic markdown file must include the moment UUIDs cited as evidence for each insight — positional indices are not acceptable. The markdown is a faithful projection of the DB schema, which enforces UUID-based evidence linking.
- Insight categories rendered in markdown are constrained by the post-adversarial-review schema: `flow` is removed (redundant with architecture), `risk` and `gap` are merged. Any new category must pass the litmus test: 'Does knowing the category change what the agent *does* with the insight?'

## decision

- Brain synthesis uses a pre-computed moment index injected into the prompt, requiring the LLM to cite evidence by stable moment UUID rather than positional index. This is a structural fix — not a prompt-wording fix — for ungrounded or hallucinated insight citations.
- Brain state is stored in BOTH Postgres AND committed markdown files under .repo/ — Postgres enables structured querying while .repo/ files make the brain accessible to coding agents on any branch without needing the running system. These are not redundant; they serve different consumers.
- Markdown files are committed to `.repo/` specifically so agents on any branch can read brain state without database infrastructure — the markdown layer is a read-only projection of Postgres, not the source of truth.
- The brain synthesis function accepts generic `evidence` objects, not session-specific types. This is a hard architectural constraint ensuring the pipeline is evidence-source-agnostic — PR-based agentic analysis or any future source can feed synthesis without pipeline changes.
- Brain insight categories were pruned through adversarial review using the litmus test: 'Does knowing the category change what the agent *does* with the insight?' `flow` was removed as redundant with `architecture`; `risk` and `gap` were merged because they are inseparable in practice. Any future category additions must pass this litmus test.
- The brain synthesis function accepts generic `evidence` objects rather than session-specific types, making the pipeline evidence-source-agnostic. PR-based analysis, agentic runs, or any future evidence source can feed the same synthesis function without pipeline changes.
- The brain synthesis function accepts generic `evidence` objects rather than typed `sessionDigest` objects — this is a deliberate architectural constraint so that PR-based or other non-session analysis sources can feed the same synthesis pipeline without modification.

## behavior

- Each `intent brain` CLI run creates a new BrainVersion record with a parent pointer to the previous version, forming a parent→child chain. The brain versions per run — not per session or per commit. Version chain integrity is verifiable: v1 has no parent, v2 points to v1, and topics accumulate across versions.
- Each `intent brain` CLI run creates a BrainVersion record with a parent pointer to the previous version, building a traceable chain. Topics accumulate across runs — a run adds new topics/insights to the graph rather than replacing or partitioning by session.
- Brain synthesis requires a pre-computed moment index (UUID → statement mapping) injected into the LLM prompt, with the output schema requiring citations by moment UUID. Without this pre-computation, evidence linking breaks — the LLM cannot reliably reference moments by position, only by stable UUID.
- `brain-export` CLI command triggers `generate-markdown.ts` to read all topics, insights, and evidence from Postgres and write `.repo/brain.md` plus per-topic files under `.repo/topics/`. This must be run after every `intent brain` synthesis run to keep committed files in sync with the latest BrainVersion.
- Each `intent brain` run creates a new BrainVersion with a parent pointer, and the subsequent `brain-export` reflects the latest version's state. The markdown files always represent the most recent BrainVersion — historical versions are queryable in Postgres but not committed as separate markdown snapshots.

## risk

- Evidence linking quality is fragile — it depends on the moment index being correctly pre-computed and injected before the LLM call. If the index is stale, incomplete, or the UUID citation requirement is relaxed in the prompt schema, insights will be ungrounded and the evidence chain silently breaks.
- The dual-store design (Postgres + committed markdown) creates a sync risk: if a brain run writes to Postgres but fails before committing markdown files, the two stores diverge. The markdown files are what agents read at runtime, so a stale .repo/ directory means agents operate on outdated knowledge even if the DB is current.

## interface

- The .repo/brain.md and .repo/topics/*.md files are the agent-facing interface to the brain. They are generated by brain-export from the Postgres DB and committed to the repo. Agents read these files directly — they must remain valid markdown and accurately reflect DB state after every brain run.
- `.repo/brain.md` is the agent entry point — it must provide a navigable overview linking to per-topic files. `.repo/topics/<slug>.md` files are the per-topic brain crumbs. Agents are expected to read these files directly; their structure is an external contract that should not change without considering agent compatibility.

## Files

- `.repo/brain.md` — Agent-facing brain overview markdown — top-level entry point linking to per-topic files; output artifact of brain-export
- `.repo/brain.md` — Agent-navigable brain index committed to repo — entry point for coding agents to discover topics without running the system
- `.repo/brain.md` — Committed brain overview markdown — primary agent entry point for navigating the knowledge graph without infrastructure
- `.repo/brain.md` — Committed brain overview markdown — primary agent-facing entry point for navigating the knowledge graph without infrastructure
- `.repo/topics/moment-detection.md` — Example per-topic brain-crumb file — illustrates the thin pointer format agents use to navigate to specific topic knowledge
- `.repo/topics/moment-detection.md` — Example per-topic brain-crumb markdown file — illustrates the structure of committed topic-level knowledge artifacts
- `.repo/topics/moment-detection.md` — Example per-topic brain-crumb markdown — illustrates the structure of committed topic files agents read for domain knowledge
- `.repo/topics/moment-detection.md` — Example per-topic brain crumb markdown — illustrates the structure of topic files generated by brain-export, including insights and UUID evidence citations
- `src/adapters/types.ts` — Brain domain types: BrainTopic, BrainInsight, BrainVersion, and the generic evidence input type that keeps the pipeline source-agnostic
- `src/adapters/types.ts` — Brain type definitions — defines the Topic, Insight, and Evidence shapes that generate-markdown.ts consumes
- `src/adapters/types.ts` — Defines brain types including the generic evidence interface that keeps synthesis source-agnostic
- `src/adapters/types.ts` — TypeScript type definitions for brain entities — BrainVersion, BrainTopic, BrainInsight, BrainEvidence
- `src/brain/generate-markdown.ts` — Core markdown generation module — reads brain_topics, brain_insights, brain_evidence from Postgres and writes .repo/brain.md and .repo/topics/<slug>.md files
- `src/brain/generate-markdown.ts` — Exports brain DB state to .repo/ markdown files, enabling agent navigation without database access
- `src/brain/generate-markdown.ts` — Exports brain state to .repo/ markdown files after each run, keeping the agent-readable knowledge tree in sync with the Postgres store
- `src/brain/generate-markdown.ts` — Exports brain state to .repo/ markdown files after each synthesis run, making the brain navigable by coding agents without infrastructure
- `src/cli/index.ts` — CLI entry point — wires brain-export and brain-synthesis commands, calls createBrainVersion on each brain run
- `src/cli/index.ts` — CLI entry point — wires `intent brain` command, calls createBrainVersion on every run to maintain the version chain
- `src/cli/index.ts` — CLI entry point — wires the brain-export command that triggers markdown generation, and brain-synthesis command that must run first to populate the DB
- `src/cli/index.ts` — CLI wiring: `intent brain` command triggers the full synthesis + versioning + markdown export pipeline
- `src/llm/prompts/brain-synthesis.ts` — Brain synthesis LLM prompt — defines the output schema that requires moment UUID citations, enforcing grounded evidence linking
- `src/llm/prompts/brain-synthesis.ts` — Brain synthesis LLM prompt — pre-computes moment index with UUIDs and enforces UUID citation in the output schema to prevent positional index drift
- `src/llm/prompts/brain-synthesis.ts` — Brain synthesis prompt — injects pre-computed moment index with UUIDs, enforces UUID citation in output schema to prevent positional index drift
- `src/llm/prompts/brain-synthesis.ts` — Defines the synthesis prompt that enforces UUID evidence citations — the UUID constraint flows through to what markdown generation renders
- `src/pipeline/brain-synthesis.ts` — Core brain synthesis: LLM call with moment index injection, topic extraction, DB storage via storeTopics(), and version chain creation via createBrainVersion()
- `src/pipeline/brain-synthesis.ts` — Core brain synthesis pipeline — accepts evidence, produces topics/insights, stores to Postgres, and calls createBrainVersion to record the new version snapshot
- `src/pipeline/brain-synthesis.ts` — Core brain synthesis pipeline — accepts generic evidence objects, produces topics and insights with UUID-cited evidence, drives the versioned knowledge accumulation
- `src/pipeline/brain-synthesis.ts` — Upstream dependency — runs LLM synthesis and stores topics/insights/evidence to DB before brain-export can generate accurate markdown
- `src/storage/schema.ts` — Defines brain tables: brain_versions (version chain with parent pointers), brain_topics, brain_insights, brain_evidence, topic_sessions (join table linking topics to contributing sessions)
- `src/storage/schema.ts` — Defines brain_versions, brain_topics, brain_insights, brain_evidence tables — the Postgres schema for versioned brain storage
- `src/storage/schema.ts` — Defines brain_versions, brain_topics, brain_insights, brain_evidence tables — the source data that markdown generation reads and projects into files
- `src/storage/schema.ts` — Defines Postgres brain tables: brain_versions (parent chain), brain_topics, brain_insights, brain_evidence, topic_sessions

## Evidence

- May 21: The developer set out to build v2 of the project from scratch, explicitly leaving v1 behind as re... (3 moments)
- May 21: The developer set out to design the intent-ai project from scratch, starting with no existing cod... (13 moments)
- May 23: The session began with infrastructure failures — no DATABASE_URL, hanging processes, and Zod vali... (85 moments)
