# Brain API — Critical Review & v1.1 Contract

> **Historical (superseded 2026-07-04):** This review (2026-07-03) identifies issues with the Topic graph integration and MCP surface. The Topic ontology was excised on 2026-07-04; for current MCP surface, see `docs/specs/2026-07-04-*` (if available) and `src/mcp/`. The structural findings (F3, F4, F5, F6) remain actionable for v1.1 work.

> Status: review accepted, v1.1 contract proposed · Date: 2026-07-03
> Reviewed: `src/mcp/server.ts`, `src/mcp/feature.ts`, write path in `src/storage/queries.ts` as of `b26c2bf`.
> Referenced by [`docs/prd.md`](../prd.md) §MCP Surface.

## Verdict

The write side is well-behaved (failure-safe, human-gated, honest "pending review" responses). The read side is **two APIs wearing one trenchcoat**, and several contract promises the PRD makes are not kept by the implementation. None of this is hard to fix; all of it will confuse the first real agent consumer.

## Findings

### F1 — Two ontologies, two stores, one tool list (highest severity)

`brain_overview` / `brain_search` / `brain_get` / `brain_traverse` read the **Topic** graph parsed from `.repo/*.md` markdown (`server.ts:154-181`). `brain_enter` / `brain_file_context` / `brain_feature_context` + all writes read/write **Features** in Postgres. The two surfaces share no ids, no vocabulary, and no data: `brain_search` cannot find a Feature; `brain_enter` cannot see a Topic. An agent that calls `brain_search("events")` then `brain_enter(task:"events")` gets answers from two unrelated worlds — and `brain_overview`, the tool described as "start here," orients the agent in the *retired* ontology. This also breaks PRD Principle 7 (plain vocabulary): the API speaks "specs," "topics," "cards," and "Features" simultaneously.

**Fix:** one ontology per surface. Week 1: re-key `brain_search` onto Features (name · current understanding · observation summaries · file paths — the star-search already in the backlog) and remove or hide the Topic tools from the default tool list. The `.repo/` markdown remains an *export*, not a served surface.

### F2 — "Never silently guesses" is false for tasks

`resolveTask` (`feature.ts:167-178`) auto-selects any **single** candidate above a 0.3 fuzzy-token threshold. With a handful of seeded Features, "exactly one above 0.3" is the *common* case, and a 0.31 token-overlap match is a guess by any definition. The PRD promises candidate lists on ambiguity; file resolution honors this (longest-glob-wins with tie → candidates), task resolution does not.

**Fix:** auto-resolve only above a high-confidence threshold (≥0.8, i.e. near-exact) **and** with a clear margin over the runner-up (e.g. 2×); otherwise return candidates. Log every auto-resolution as an event so resolution quality is measurable (see F6).

### F3 — Prose-only outputs force agents to parse ids out of sentences

Every tool returns a single text block. Candidate lists arrive as markdown bullets with `[id: …]` embedded (`formatCandidates`, `feature.ts:203-213`); the agent must regex the id back out — exactly the string-parsing fragility this repo's own conventions warn about. MCP supports structured content alongside text.

**Fix:** return `structuredContent` (e.g. `{ resolved: false, candidates: [{id, name, summary}] }`) alongside the human-readable text on `brain_enter`, `brain_file_context`, and `brain_search`. Keep prose for the served context itself — that part is genuinely for a model to read.

### F4 — Schema constraints missing where the repo's own doctrine demands them

`brain_rate_context` takes `rating: z.number()` with "e.g. 1-5" **in the description** (`server.ts:703`) — the exact anti-pattern this team already learned and recorded ("schema constraints > prompt instructions"): nothing stops `rating: 47` or `-2`, and downstream analysis inherits garbage. Similarly, `featureId` on all four write tools is an unvalidated free string: a typo'd or hallucinated id is stored silently as if attributed.

**Fix:** `z.number().int().min(1).max(5)`; validate `featureId` against the DB and return "unknown feature, observation stored unattributed" honestly rather than silently mis-filing.

### F5 — Writes capture no provenance

`insertObservation` calls carry summary/kind/tags/files but no **session id, agent identity, or repo/branch** captured at the API boundary. PRD Principle 4 is "evidence over assertion — every piece of understanding traces back to artifacts"; the write path is where that trace is born, and it is born empty. The approval UI shows a reviewer *what* was noticed with no *who/when/during-what*.

**Fix:** accept optional `sessionId` from the caller, and stamp server-side context (cwd → repo, branch, timestamp, MCP client info) into every event's metadata. This is also load-bearing for measurement v2's provenance audit.

### F6 — The surface is blind to itself

No MCP call emits an `activity_event`. Brain's thesis is "capture every significant thing that happens in development" — yet an agent consulting Brain, the most Brain-relevant event there is, leaves no trace. Consequences: `brain.enter` hit/miss rate is unmeasurable, resolution quality (F2) is unmeasurable, and the observability layer (see the observability handoff) has a hole where its most interesting lane should be.

**Fix:** every tool call emits `mcp:<tool>` events (feature id, hit/miss/candidates, latency, session id when known) via the existing failure-safe `emitEvents` pattern.

### F7 — `brain_propose_knowledge_delta` fakes an object that was cut

Week-1 explicitly trims Knowledge Delta from the object set ("modeling ahead of validation"), yet the tool exists — implemented as an ordinary observation with `before/after` tucked into metadata (`server.ts:721-743`). This is ontology-by-stealth: the API advertises a capability the model doesn't have, and reviewers see a "delta" that diffs nothing.

**Fix:** remove the tool for Week 1 (agents can say the same thing via `brain_report_observation(kind: "proposed-change")`); reintroduce it when Knowledge Delta becomes a real object (P2-alignment).

### F8 — Failure and emptiness are indistinguishable

Errors return normal text results — `brain_enter unavailable: <msg>` (`server.ts:619`). Resilient, but an agent (and any eval) cannot distinguish "Brain has nothing for this file" from "Postgres is down," and treatment-arm sessions in the A/B would silently degrade to baseline behavior while still being scored as treatment.

**Fix:** use MCP's `isError` flag on genuine failures; reserve plain text for genuine empty-knowledge responses. The measurement runner must fail a treatment run whose `brain_enter` errored.

### Minor

- **M1** — Duplicate `globToRegExp` with *different* semantics (`feature.ts:56` vs `transcript-metrics.ts:143` — the latter suffix-anchors, the former fully anchors). Unify in one module before they drift further.
- **M2** — `formatFeatureContext` caps sessions at 8 but approved observations are unbounded — a well-loved Feature will eventually blow the context budget it's meant to save. Cap + "N more, use brain_search" trailer.
- **M3** — `fuzzyScore` awards 0.5 per *substring* token hit (`feature.ts:35-37`), so "event" matches "events", "emit-events", "eventually" equally. Fine for Week 1; do not build ranking claims on it.
- **M4** — `brain_enter` with both `file` and `task` silently ignores `task` (`server.ts:604`). Prefer file but *say so* in the response, or use task to break file-candidate ties — free signal, currently dropped.

## v1.1 contract (Week-1 sized)

**Tools (7):** `brain_enter(file?, task?)` · `brain_search(query)` [Feature-keyed star search] · `brain_feature_context(featureId)` · `brain_report_observation` · `brain_report_unknown` · `brain_rate_context` — plus `brain_file_context` retained as an alias for `enter(file)` if removal breaks consumers.

**Retired/hidden:** `brain_overview`, `brain_get`, `brain_traverse` (Topic-keyed), `brain_propose_knowledge_delta`.

**Cross-cutting:** structured candidate output (F3) · strict Zod on writes (F4) · provenance stamping (F5) · self-instrumentation events (F6) · `isError` on failure (F8) · high-confidence-only task auto-resolve (F2).

What to explicitly keep as-is: the candidate-list behavior for file resolution, the failure-safe write path, the pending-review response wording, and `formatFeatureContext`'s section order (constraints before files — the right priority for an agent about to edit).
