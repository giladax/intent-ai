# Brain — Product Requirements (v0.3.2)

> Status: draft · Owner: Gilad · Date: 2026-06-27 · Amended: 2026-07-03
> Supersedes the implicit "intent↔code alignment" framing and the standalone "Brain PRD v0.2".
> Companion: [`docs/future-knowledge.md`](./future-knowledge.md) — hypotheses we consciously defer.
>
> **v0.3.2 amendments (2026-07-04):** digest fidelity named as a load-bearing precondition — the "derived" in the MVP hypothesis, the Journal's narration, and all digest-derived eval ground truth are only as strong as digestion's faithfulness to the transcript, which has never been audited. See the MVP precondition below and `docs/handoffs/2026-07-04-digest-quality-audit-handoff.md`. **Raw sessions are archived**: every digested log is copied to `.intent/raw-sessions/` (re-copied as it grows), so evidence survives Claude Code's ~30-day purge and every digest stays permanently re-derivable — fidelity audits and pipeline-improvement re-digestion never lose their source. This does not breach Principle 1: CC logs are ephemeral artifacts with no system of record; archiving them is evidence preservation, not becoming a store.
> **v0.3.1 amendments (2026-07-03):** the Journal (event river) named as the primary substrate and surface — Features are *lenses* over it, not containers; hierarchy and graph-visualization rejected as navigation primitives; the Journal becomes read-write (comments as events); hybrid search named a core capability; MCP expands from report-only writes to full management on the human's behalf. §The Model, §Positioning, §MCP Surface, §Journal below.

---

## Vision

Brain is the **organizational understanding layer** for software development. It continuously correlates business **intent** with **implementation** and serves the current understanding to humans and AI agents over API and MCP.

Brain does **not** store your work — Jira owns work, GitHub owns code, Google Docs own PRDs, Figma owns design. Brain owns the **understanding** derived from them: why things exist, what implements what, and — the spearhead — **whether what we built is still what we wanted.**

That alignment question is what makes Brain an *understanding engine* rather than enterprise search. Understanding is the umbrella; **alignment is the spearhead** that proves it.

---

## Product Principles

1. **Understanding, not storage.** Systems of record stay external. Brain owns understanding, evidence, and the relationships between them — never the source.
2. **The river is the substrate; Feature is the primary lens.** Everything that happens lands as time-ordered events in one long-living journal of the org. Features don't *contain* things — they are saved ways of slicing the river, and they *hold the understanding* that converges from their slice. Artifacts (PRs, sessions, tickets, PRDs, designs) contribute evidence as events.
2a. **No hierarchy as navigation, no graph as UI.** Knowledge is more connected than any tree; trees (and cross-linked trees) are rejected as scaffolding. But the graph lives in *retrieval* — associative expansion of any point in the river — never as a node-link diagram. Time is the one axis everyone natively understands; it stays the navigational spine.
3. **Understanding is the umbrella; alignment is the spearhead.** We lead with understanding (broad, durable, whole-org) and prove it with alignment (sharp, differentiated, defensible). Alignment is never demoted to "one of six."
4. **Evidence over assertion.** Every piece of understanding traces back to artifacts. No ungrounded claims.
5. **Human-gated mutations.** Understanding changes through reviewable deltas, never silently.
6. **Agents are first-class consumers; developers are first-class owners.** Agents are how developers reach Brain — served the same understanding via MCP.
7. **Plain vocabulary.** We say Feature, Understanding, Evidence, Observation, Current Understanding. We may build a graph internally; we do not say "knowledge graph" externally or in design docs.

---

## The Model

- **The Journal (event river)** — the primary substrate *and* the primary surface. Every significant happening — session digested, agent consulting Brain, observation noticed, review decision, integration signal, human comment — is a self-contained, time-ordered event in one stream (`activity_events`). Everything else in this model is a derived projection over it.
- **Feature** — the primary lens. The unit humans and agents actually care about.
- **Two kinds of evidence under a Feature:**
  - *Intent-evidence* — **what we want** (PRD, ticket, decision, Slack thread).
  - *Implementation-evidence* — **what we have** (PR, coding session, code).
- **Observation** — a captured noticing (by an agent, a human, or the pipeline), attached to a Feature.
- **Current Understanding** — Brain's synthesized answer for a Feature, built from its evidence.
- **Alignment** — the comparison, *within a Feature*, of intent-evidence vs implementation-evidence. It is **not a separate system**; it falls out of holding both kinds of evidence under one node.

This reconciles the two framings we debated: the "intent↔code alignment" idea is simply *what you can ask once a Feature holds both its intent-evidence and its implementation-evidence.* The part is contained by the whole.

---

## Primary Users & Consumer Arc

**Now — developers and their agents.**
- *While building:* "What do we actually want here?" — intent surfaces next to the code being touched.
- *While planning:* "What's unmet?" — intent with no implementation is visible work, not tribal knowledge.
- *While reviewing / picking up cold:* "What governs this code, and is it still aligned?"

**Next — the whole org.** Tech leads ("is what we wanted built?"), PMs, QA, support. The intent↔implementation map is org-wide shared infrastructure; developers are the wedge because they're closest to both layers and feel the gap most.

---

## Core Questions Brain Answers

- Why does this exist?
- What should I know before changing this?
- What business requirement does this satisfy?
- **Is the implementation still aligned with the specification?**
- What recently changed?
- What do we still not know?

---

## Positioning — What Brain Is NOT

- **Not enterprise search.** Search returns documents; Brain returns *current understanding*.
- **Not a documentation system.** Brain owns no source of truth — it correlates the ones you already have.
- **Not a knowledge wiki with folders.** No tree, no filing. You never need to know where something *lives* to find it.

**Differentiator, in one line:** Brain answers *"is what we built still what we wanted?"* — a question neither search nor docs can.

*Positioning nuance on search:* rejecting "enterprise search" as an identity does not demote search as a capability — **search over the river is the front door** and must be cutting-edge at org scale: hybrid retrieval (lexical + semantic over event embeddings + structured filters + associative neighborhood expansion), one engine serving the Journal UI and `brain.search` identically, results rendered as episodes-in-context, never rows. What we refuse is *returning documents as the answer* — search finds the place in the river; understanding is what Brain says about it.

---

## Core Objects (full model)

| Object | Role |
|---|---|
| Feature | The node understanding converges on |
| Artifact (+ Revision) | External source, *referenced* not owned (PR, session, PRD, ticket, design) |
| Observation | A captured noticing attached to a Feature |
| Evidence | An artifact span supporting a claim |
| Claim | An assertion about a Feature, backed by evidence |
| Current Understanding | The synthesized, served view of a Feature |
| Knowledge Delta | A reviewable proposed change to understanding |
| Edge | A typed relationship between objects |

> The MVP deliberately uses a **trimmed subset** of these — see below.

---

## Organizational Lifecycle

External systems generate events → **Brain evaluates: did organizational understanding change?** → if yes, propose a **Knowledge Delta** → human approves when necessary → **Current Understanding** updates. **Brain never edits the source.**

---

## The Journal — the served surface (added v0.3.1)

The Journal is not a report *about* the product; it **is** the product surface. A long-living, narrated chronology of the org's development, read the way a field journal is read — and, critically, **written in**:

- **Read** — the river narrates itself: sessions, consults (hits *and* misses), observations, review decisions, integration signals, in one time-ordered stream with the Pulse as its summary sentence.
- **Comment & reply, anywhere** — a human comment is just another event (`comment:*`, pointing at its target); replies thread the same way. No separate commenting system. A comment on an event is *teaching signal* — promotable into the observation → approval → understanding loop.
- **Search** — the front door (see Positioning). Every element of the river is findable without knowing where it "lives."
- **Converse** — any element on the page can be pinned into a live conversation with Brain (the Correspondence): the page *is* the context picker. Humans and agents interrogate the same understanding.

Interaction language: editorial as brand, utilitarian as behavior — the surface tells the story (journal, clippings, stamps, red ink) while the interactions stay keyboard-first and repetition-fast. Delight is a requirement, not decoration: the developer testing it should enjoy it.

---

## MCP Surface

**Read:** `brain.enter(file|task)` · `brain.search()` · `brain.featureContext(id)` · journal/event queries
**Write (report):** `brain.reportObservation()` · `brain.reportUnknown()` · `brain.rateContext()`
**Write (manage, added v0.3.1):** agents act *on the human's behalf* with explicit actor attribution — create/update Features, manage the file↔Feature map, approve/reject/edit observations, comment. The MCP surface converges on parity with the web API: anything a human can do on the dashboard, their agent can do for them, provenance-stamped (`agent:<platform>` on behalf of `human:<handle>`). Human-gated mutations (Principle 5) still hold — the *gate decision* itself may be delegated to an agent session, but it is always attributed and always visible on the river.

Critical review of the implemented surface, with findings and the v1.1 contract: [`docs/specs/2026-07-03-brain-api-review.md`](./specs/2026-07-03-brain-api-review.md). Binding decisions from it:

1. **One ontology.** The served surface speaks *Feature* only. The legacy Topic tools (`brain_overview/search/get/traverse` over `.repo/` markdown) are retired or re-keyed onto Feature — an agent must never see two competing vocabularies and two data stores in one tool list.
2. **No silent guessing — tasks included.** The implemented task resolution auto-selects any single fuzzy match above 0.3, which *is* a silent guess and contradicts this PRD. Ambiguity always returns a candidate list.
3. **Structured outputs.** Candidate lists and ids return as structured content, not prose an agent must parse ids out of.
4. **Provenance on writes.** Every write captures session id + actor. "Evidence over assertion" starts at the API.
5. **The surface instruments itself.** Every MCP call emits an `activity_event` (tool, feature, hit/miss, latency). Brain cannot claim to observe development while being blind to its own usage.
6. **`proposeKnowledgeDelta` is deferred** along with the Knowledge Delta object the Week-1 trim already cut — as implemented it stores an ordinary observation wearing a costume, and the trim discipline should apply to the API too.

*Note on `enter`:* keyed by **task/goal or file**. In the MVP, Feature "resolution" is an honest **manual lookup** over the file↔Feature map — not solved information retrieval. We do not pretend otherwise.

---

## MVP — Week 1

### Goal
Prove — **with measurement** — that **Brain-derived feature context significantly improves coding-agent performance.** Nothing else.

**Derived is the load-bearing word.** Every constraint, understanding line, and file pointer served in the treatment arm must trace to a digested session or an approved Observation — never hand-authored into a Feature for the eval. Hand-curated context proves only that telling an agent the answer helps (already consensus); the product claim is that Brain can *learn* the answer from watching work happen.

**Precondition: digest fidelity (added v0.3.2).** "Derived from digests" is only meaningful if digests are faithful to the transcripts they summarize — a fluent digest of the wrong emphasis poisons everything downstream (served constraints, Journal narration, digest-derived eval answer keys) while *looking* healthy. Known fidelity risks as of 2026-07-04: confidence calibration collapse (17/17 high on a real session), resumed sessions permanently losing their post-digestion tail (idempotency never re-reads a grown log — systematic now that scheduled digestion triggers on a quiet-window), and digest-time event stamping destroying intra-session chronology. A transcript-vs-digest fidelity audit with a measurable fidelity eval gates the measurement run.

### Scope
Two repositories · Claude Code · Brain MCP · Postgres · session digestion · **manual** feature management (Features and the file↔Feature map stay manually *managed*; their *content* must be Brain-derived per the rule above).

- **Primary: `intent-ai`** — the only repo with surviving session history. Hard mode: the baseline docs here are unusually strong, so a win means something.
- **Generalization arm: one external repo (`story-time`)** — must be seeded with 5–10 real working sessions first (prior logs were purged by Claude Code's ~30-day retention; the evidence corpus has to be regenerated). Representative mode: decent docs, no answer key, closer to a real customer repo.

> Session evidence **evaporates** (30-day log retention) — for anything not yet digested. As of v0.3.2, digestion archives every raw log to `.intent/raw-sessions/`, so digested evidence never evaporates and history can be re-digested by a better pipeline. Continuous capture (scheduled digestion) remains what gets logs into the archive before the purge.

### Trimmed object set (Week 1)
**Feature · Session · Observation · file↔Feature map · Current Understanding (text).**
We **cut Claim, Evidence-as-object, and Implementation Object from Week 1** — nothing generates them yet (automatic claim generation is out of scope), so carrying them is modeling ahead of validation.

### Supported flow
1. Claude calls `brain.enter(file | task)`.
2. Brain resolves the **Feature** via the manual file↔Feature map; on 0 or >1 match it returns the **candidate list** for the agent to pick — it does not silently guess.
3. Brain returns: feature summary · current understanding · constraints · relevant files · related sessions · known unknowns · agent instructions.
4. Claude works.
5. Claude reports: Observation · Unknown · Tech debt · Context-quality rating → stored as `activity_events`.
6. **No automatic promotion.** A simple UI lists pending observations → approve / reject / edit.

### What already exists vs. net-new (grounded in this repo)

| Need | Status | Where |
|---|---|---|
| Feature node + session linking | **Exists** | `features`, `feature_sessions` (`src/storage/schema.ts`) |
| Observation substrate | **Exists** | `activity_events` (category/tags/files/metadata/embedding) |
| Session digestion | **Exists** | `src/pipeline/` (raw→normalized→moments→narrative) |
| `brain.enter(file)` ≈ feature context | **Partial** | `brain_file_context` in `src/mcp/server.ts` (file/topic-scoped, not feature-scoped) |
| Eval machinery | **Exists** | `src/eval/{fitness,judge,brain-judge,runner}.ts`, `tests/eval/` |
| file↔Feature mapping | **Net-new** | only `feature_sessions` exists today; need file→feature resolution |
| Feature `currentUnderstanding` / constraints / known-unknowns | **Net-new** | `features` has only `name`/`description` |
| `featureContext()` assembler | **Net-new** | feature-scoped bundle distinct from file/topic context |
| Write-side MCP tools | **Net-new** | MCP server is read-only today |
| Pending-observation approval UI | **Net-new** | dashboard exists (`src/web/`); add a review queue |

**Build notes (CTO).** New `feature_files(feature_id, glob, file_path)` join, longest-glob-wins; bootstrap the initial map from `feature_sessions` → each session's affected files, then human-correct. Current Understanding in Week 1 = `features.description` text + approved Observations (assembled, *not* "continuously constructed"). The read path is ~80% built; the real net-new work is the **write path** (observe→approve→improve) plus re-keying context on Feature. **Honest effort: ~6–8 working days** — long pole is the approval-UI loop and the eval harness, not the brain plumbing.

### Measurement harness — **in scope** (this is the proof, not a demo)

The repo's own EDD principle requires this: a goal phrased as "*prove*" needs a baseline, a metric, **and a pre-registered bar**, or it cannot fail.

Full mechanics: [`docs/specs/2026-07-03-measurement-v2-spec.md`](./specs/2026-07-03-measurement-v2-spec.md). The v1 harness (commit `c7fab1e`) implemented sound scoring math over an **invalid experimental design**; v2 keeps the math and fixes the design. The binding rules:

- **Hypothesis (falsifiable):** With **Brain-derived** feature context injected at task start (`brain.enter`), a coding agent reaches a correct, constraint-respecting edit with materially less information-gathering *and* fewer constraint violations than the same agent armed only with the repo's existing docs.
- **Baseline arm:** Claude Code + existing `.repo/brain.md` + `CLAUDE.md`, **Brain MCP disabled.** (Feature context must beat *good repo docs*, not beat nothing.)
- **Treatment arm:** identical repo + task, Brain MCP enabled, agent calls `brain.enter` first. Only the *context source* varies; model/prompt/temperature/commit held constant.
- **Provenance rule.** Treatment context is assembled from digested sessions + approved Observations only. No constraint may be hand-typed into a Feature for the eval.
- **Hold-out constraints.** A discriminating constraint is valid only if it appears in **no document the baseline receives** (CLAUDE.md, `.repo/brain.md`). v1's tasks 2 and 4 failed this — their constraints are verbatim in CLAUDE.md, which is injected into every baseline prompt, making the baseline-CVR floor structurally unreachable.
- **Decontaminated checkout.** Both arms run in a worktree that excludes the harness and task criteria; in v1 the answer key (`src/eval/mvp-task-criteria.ts`) was committed to the repo both arms explore.
- **Efficiency is symmetric.** ETC counts **all** information-gathering, including `brain_*` MCP reads (v1 excluded them, making treatment exploration free by construction). **Tokens-to-completion is co-primary** — served context is not free.
- **CVR detection is deterministic first.** Structural checks on the final diff (enum/CHECK, missing try/catch, JOINs) with a Haiku judge as tie-breaker only. A "treatment CVR = 0" bar may not hinge on a single judge call.
- **Live collection is a deliverable, not a stub.** The runner that spawns headless sessions with MCP toggled and captures transcript + diff + tsc/test results was v1's unowned long pole.

**Two primary metrics** (definitions unchanged in spirit): **ETC** — information-gathering tool calls to first correct edit; **CVR** — constraint-violation rate on the final diff. CVR remains the sharpest discriminator: it measures the *unique* value of feature context (the right constraint at the right moment), not generic retrieval speed. Secondary: task success (`tsc --noEmit` + targeted test + judge) · turns · `rateContext()` self-report (never feeds the pass bar).

**Task set:** 5 real tasks per repo, re-drawn under the hold-out rule (**v1's task list is retired**), each a `TaskCriteria { goal, correctFiles[], constraints[], acceptance }` written before any run and kept outside the eval checkout.

- **Variance:** N=5 per (task × arm) on the two sharpest tasks, N=3 on the rest; report medians + all raw values; claim directional consistency, not statistical significance.
- **Pass bar (pre-registered):** ship iff (median) **ETC ≤ 0.7× baseline on ≥3/5 tasks** AND **baseline CVR ≥2 violations → treatment CVR = 0** AND **treatment success ≥ baseline** AND **treatment tokens ≤ 1.15× baseline.**
- **Kill switch:** any one of — ETC reduction ≤10%, OR treatment CVR ≥ baseline CVR, OR treatment success < baseline, OR treatment tokens > 1.5× baseline → feature context isn't earning its complexity; don't ship the loop as-is.

### Out of scope (Week 1)
Automatic feature discovery · PRD/Docs/Jira ingestion · knowledge evolution · branch workspaces · conflict resolution · automatic claim generation. (See `future-knowledge.md`.)
Graph *visualization* is not merely deferred — it is rejected as a UI (Principle 2a); the graph serves retrieval only.

### The alignment commitment (read this once, out loud)
> The MVP deliberately tests the **single-repo agent-context loop** and contains **no intent layer**. Intent ingestion and **alignment/drift detection are Phase 2 and remain the real moat.** The wedge ("feature-aware context for agents") is a crowded space; the win ("is what we built still what we wanted?") is the defensible one. We are sequencing, not reversing — and we will not mistake the wedge for the win.

---

## Organizational Data Points — probable integrations

Brain's evidence today is code + coding sessions. Each integration below adds an organizational signal as **events in the river, sliced by Feature lenses** — never a new store (Principle 1). Mechanically every integration is the same shape: an adapter emitting `integration:<source>` events into the journal — a new *correspondent writing into the same journal*, not a bolted-on system. Ingestion is **pluggable, PRD-first** (see `future-knowledge.md` §Spec-Driven Development); each source maps to Artifact (+Revision) references classified as intent- or implementation-evidence. Probable order:

| Phase | Source (probable integration) | Evidence kind | Question it unlocks |
|---|---|---|---|
| P2 | **PRDs** — Google Docs / Notion / Confluence | intent | "Is what we built still what we wanted?" — the moat |
| P2 | **GitHub / GitLab** — PRs, reviews, issues | implementation | "What changed here, and what governed the change?" |
| P3 | **Jira / Linear** — tickets, epics | intent | "What was actually asked for? What's unmet?" |
| P3 | **Slack / Teams** — decision threads | intent | "Where was this decided, by whom, and why?" |
| P3 | **Figma** — designs, design specs | intent | "Does what we built match what we designed?" |
| P3 | **CI / test results** | implementation | "Is this feature healthy right now?" |
| P4 | **Incident tools** — PagerDuty, incident.io | implementation | "Which intent did this outage betray?" |
| P4 | **Support / CS** — Zendesk, Intercom | intent (external) | "What do users believe this feature promises?" |

Two rules keep this honest: an integration earns its place only if it makes the intent↔implementation relationship more legible for a Feature (the roadmap's single judging question), and no integration enters scope before the MVP bar is met.

---

## Roadmap Arc

- **P0 — today.** One layer: code understanding from sessions, served via MCP + dashboard.
- **P1 — MVP.** The feature-aware agent-context loop, measured. *(this doc)*
- **P2 — Intent enters + alignment.** Pluggable signal ingestion (PRD-first) as intent-evidence; alignment becomes observable (unmet / ungoverned). **The moat.**
- **P3 — Multi-signal, whole-org.** Specs, tickets, Slack, design as evidence; PMs/leads/QA/support as consumers.
- **P4 — Drift as a standing capability.** Continuous alignment assessment and freshness.

Every increment is judged by one question: *does it make the intent↔implementation relationship more legible?*

---

## Success Metrics

- **MVP headline:** significant reduction in information-gathering-to-first-correct-edit vs. the doc baseline, at equal-or-better task success and no material token overhead — with all treatment context **Brain-derived**.
- **Beyond MVP:** developers answer *"why?"* without reading multiple documents · repeated unknowns decrease · feature context measurably improves across repeated sessions · organizational understanding stays fresh.
