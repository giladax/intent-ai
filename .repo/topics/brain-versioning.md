# Brain Versioning

> Children: [Brain Insight Categories](brain-insight-categories.md), [Brain Synthesis Quality](brain-synthesis-quality.md), [Static Repo Index](static-repo-index.md)

Brain Versioning is the mechanism by which the Repo Brain accumulates and tracks knowledge over time. Each invocation of `intent brain` creates a new BrainVersion record in Postgres with a parent pointer to the previous version, forming a traceable chain (v1 → v2 → v3 ...). This is not a session-to-commit mapping — a single brain run synthesizes evidence from one or more sessions and appends new topics/insights to the graph, with the version record acting as a snapshot of the graph state at that point. The brain state is persisted in two complementary stores: Postgres tables (brain_versions, brain_topics, brain_insights, brain_evidence, topic_sessions) for structured querying, and committed markdown files under .repo/ for agent-readable navigation without infrastructure. The synthesis pipeline is deliberately evidence-source-agnostic — it accepts generic evidence objects rather than session-specific types, meaning PR-based or other non-session sources can feed the same pipeline without modification. Insight quality is enforced structurally: the synthesis prompt pre-computes a moment index and requires UUID citations in the output schema, preventing positional index drift and making every insight verifiable. Brain mutations are always human-gated — the brain is shared curated knowledge, distinct from the private sessions view. Insight categories and synthesis quality details are covered in the child specs 'Brain Insight Categories' and 'Brain Synthesis Quality'.

## structure

- Brain state lives in two complementary stores simultaneously: Postgres tables for structured querying and committed .repo/ markdown files for agent-readable navigation — agents on any branch can read brain state without running the system infrastructure.
- The brain synthesis pipeline flows in a fixed sequence: session digests → brain-synthesis.ts (LLM call with pre-computed moment index) → storeTopics() (DB persistence with merge logic) → createBrainVersion() (version chain record with parent pointer) → generate-markdown.ts (.repo/ export). Each `intent brain` run creates exactly one new BrainVersion pointing to its parent.
- Brain state lives in two complementary stores: Postgres tables (brain_versions, brain_topics, brain_insights, brain_evidence, topic_sessions) for structured querying, and committed markdown files under .repo/ for agent-readable navigation without any infrastructure dependency. Both must stay in sync after each brain run.
- Brain state lives in two synchronized stores: Postgres (brain_versions, brain_topics, brain_insights, brain_evidence tables) and committed .repo/ markdown files. Postgres is the source of truth; markdowns are derived exports that allow agents on any branch to read brain state without database access.
- The markdown generation step is downstream of brain synthesis — it consumes the already-stored DB state rather than re-running LLM synthesis. The two steps are separate CLI commands (`brain-synthesis` then `brain-export`), keeping generation stateless and idempotent.

## constraint

- Brain insight evidence MUST cite specific moment UUIDs — never positional indices. The synthesis prompt pre-computes a moment index with IDs and the output schema requires UUID citations. Positional indices are structurally incorrect and will produce evidence links that drift as moment order changes.
- Brain mutations are never automatic — they are always human-gated. Sessions are private/personal data; the brain is shared curated knowledge. The topic detail panel must show which sessions contributed to each topic, making the bridge between private sessions and shared brain visible.
- Insight categories must pass the litmus test: 'Does knowing the category change what the agent *does* with the insight?' Categories that fail this test are rejected. Specifically: `flow` was removed as redundant with `architecture`, and `risk`/`gap` were merged because they are inseparable in practice. Do not re-introduce these without re-running the adversarial review gate.
- Brain mutations are never automatic — they are always human-gated via explicit `intent brain` invocation. The sessions view is private/personal; the brain is shared curated knowledge. The topic detail panel must show which user sessions contributed to each topic, making the bridge between private sessions and shared brain visible.
- Each per-topic markdown file must include the moment UUIDs cited as evidence for each insight — positional indices are not acceptable. The markdown is a faithful projection of the DB schema, which enforces UUID-based evidence linking.
- Insight categories rendered in markdown are constrained by the post-adversarial-review schema: `flow` is removed (redundant with architecture), `risk` and `gap` are merged. Any new category must pass the litmus test: 'Does knowing the category change what the agent *does* with the insight?'

## decision

- Brain synthesis uses a pre-computed moment index injected into the prompt, requiring the LLM to cite evidence by stable moment UUID rather than positional index. This is a structural fix — not a prompt-wording fix — for ungrounded or hallucinated insight citations.
- Markdown files are committed to `.repo/` specifically so agents on any branch can read brain state without database infrastructure — the markdown layer is a read-only projection of Postgres, not the source of truth.
- Brain state is stored in BOTH Postgres AND committed markdown files under .repo/ — Postgres enables structured querying while .repo/ files make the brain accessible to coding agents on any branch without needing the running system. These are not redundant; they serve different consumers.
- The synthesis pipeline accepts generic `evidence` objects rather than `sessionDigest` types — this is a deliberate architectural choice so that PR-based or other non-session evidence sources can feed the same pipeline without any pipeline changes.
- The brain synthesis function accepts generic `evidence` objects, not session-specific types. This is a hard architectural constraint ensuring the pipeline is evidence-source-agnostic — PR-based agentic analysis or any future source can feed synthesis without pipeline changes.
- The brain synthesis function accepts generic `evidence` objects rather than typed `sessionDigest` objects — this is a deliberate architectural constraint so that PR-based or other non-session analysis sources can feed the same synthesis pipeline without modification.
- Brain insight categories were redesigned after adversarial review using the litmus test: 'does knowing the category change what the agent does with the insight?' — `flow` was dropped as redundant with `architecture`, and `risk`/`gap` were merged as inseparable. Do not revert to the original 7-category schema.
- Brain insight categories were pruned through adversarial review using the litmus test: 'Does knowing the category change what the agent *does* with the insight?' `flow` was removed as redundant with `architecture`; `risk` and `gap` were merged because they are inseparable in practice. Any future category additions must pass this litmus test.
- The brain synthesis function accepts generic `evidence` objects rather than session-specific types, making the pipeline evidence-source-agnostic. PR-based analysis, agentic runs, or any future evidence source can feed the same synthesis function without pipeline changes.

## behavior

- Each `intent brain` CLI run creates a BrainVersion record with a parent pointer to the previous version, building a traceable chain (v1 → v2 → ...). Versioning is per-run, not per-session or per-commit — a single run may synthesize evidence from multiple sessions.
- Each `intent brain` CLI run creates a new BrainVersion record with a parent pointer to the previous version, forming a parent→child chain. The brain versions per run — not per session or per commit. Version chain integrity is verifiable: v1 has no parent, v2 points to v1, and topics accumulate across versions.
- Brain synthesis pre-computes a moment index with UUIDs and injects it into the LLM prompt, requiring the model to cite specific moment IDs in its output. This is the structural mechanism that makes insights verifiable and traceable — it is a topology/pre-computation fix, not a prompt-wording fix.
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

- `.repo/brain.md`
- `.repo/topics/moment-detection.md`
- `src/adapters/types.ts`
- `src/brain/generate-markdown.ts`
- `src/cli/index.ts`
- `src/llm/prompts/brain-synthesis.ts`
- `src/pipeline/brain-synthesis.ts`
- `src/storage/schema.ts`
- _from [Brain Synthesis Quality](brain-synthesis-quality.md):_
  - `src/pipeline/classify-exchanges.ts`

## Sessions

- May 21: The developer set out to build v2 of the project from scratch, explicitly leaving v1 behind as re... (3 moments)
- May 21: The developer set out to design the intent-ai project from scratch, starting with no existing cod... (13 moments)
- May 23: The session began with infrastructure failures — no DATABASE_URL, hanging processes, and Zod vali... (85 moments)
