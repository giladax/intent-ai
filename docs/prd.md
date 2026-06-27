# Brain — Product Requirements (v0.3)

> Status: draft · Owner: Gilad · Date: 2026-06-27
> Supersedes the implicit "intent↔code alignment" framing and the standalone "Brain PRD v0.2".
> Companion: [`docs/future-knowledge.md`](./future-knowledge.md) — hypotheses we consciously defer.

---

## Vision

Brain is the **organizational understanding layer** for software development. It continuously correlates business **intent** with **implementation** and serves the current understanding to humans and AI agents over API and MCP.

Brain does **not** store your work — Jira owns work, GitHub owns code, Google Docs own PRDs, Figma owns design. Brain owns the **understanding** derived from them: why things exist, what implements what, and — the spearhead — **whether what we built is still what we wanted.**

That alignment question is what makes Brain an *understanding engine* rather than enterprise search. Understanding is the umbrella; **alignment is the spearhead** that proves it.

---

## Product Principles

1. **Understanding, not storage.** Systems of record stay external. Brain owns understanding, evidence, and the relationships between them — never the source.
2. **Feature is the primary unit.** Artifacts (PRs, sessions, tickets, PRDs, designs) *contribute evidence*; Features *hold understanding*. Everything converges into Features.
3. **Understanding is the umbrella; alignment is the spearhead.** We lead with understanding (broad, durable, whole-org) and prove it with alignment (sharp, differentiated, defensible). Alignment is never demoted to "one of six."
4. **Evidence over assertion.** Every piece of understanding traces back to artifacts. No ungrounded claims.
5. **Human-gated mutations.** Understanding changes through reviewable deltas, never silently.
6. **Agents are first-class consumers; developers are first-class owners.** Agents are how developers reach Brain — served the same understanding via MCP.
7. **Plain vocabulary.** We say Feature, Understanding, Evidence, Observation, Current Understanding. We may build a graph internally; we do not say "knowledge graph" externally or in design docs.

---

## The Model

- **Feature** — the node. The unit humans and agents actually care about.
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

**Differentiator, in one line:** Brain answers *"is what we built still what we wanted?"* — a question neither search nor docs can.

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

## MCP Surface

**Read:** `brain.enter(target)` · `brain.search()` · `brain.trace()` · `brain.featureContext()`
**Write:** `brain.reportObservation()` · `brain.reportUnknown()` · `brain.rateContext()` · `brain.proposeKnowledgeDelta()`

*Note on `enter`:* keyed by **task/goal or file**. In the MVP, Feature "resolution" is an honest **manual lookup** over the file↔Feature map — not solved information retrieval. We do not pretend otherwise.

---

## MVP — Week 1

### Goal
Prove — **with measurement** — that **feature-aware context significantly improves coding-agent performance.** Nothing else.

### Scope
One repository (this one) · Claude Code · Brain MCP · Postgres · session digestion · **manual** feature management.

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

The repo's own EDD principle requires this: a goal phrased as "*prove*" needs a baseline, a metric, **and a pre-registered bar**, or it cannot fail. Built on existing infra (`src/eval/{fitness,brain-judge,runner}.ts`, `tests/eval/`) recomposed as a two-arm A/B.

- **Hypothesis (falsifiable):** With Brain feature context injected at task start (`brain.enter`), a coding agent reaches a correct, constraint-respecting edit with materially fewer exploratory tool calls *and* fewer constraint violations than the same agent armed only with the repo's existing docs.
- **Baseline arm:** Claude Code + existing `.repo/brain.md` + `CLAUDE.md`, **Brain MCP disabled.** (Feature context must beat *good repo docs*, not beat nothing.)
- **Treatment arm:** identical repo + task, Brain MCP enabled, agent calls `brain.enter` first. Only the *context source* varies; model/prompt/temperature/commit held constant.

**Two primary metrics:**
- **ETC — Exploratory Tool-calls to first Correct edit.** Read/Grep/Glob/search calls before the first Edit/Write in a task-correct file. Measures efficiency. Extracted deterministically from the agent's own session JSONL (the same logs we digest — dogfood).
- **CVR — Constraint-Violation Rate.** Did the final diff violate the feature's pre-listed constraint (e.g. added an enum/CHECK on `activity_events.category`; a non-lenient Zod field; bypassed the `emitEvents` try/catch)? **This is the sharpest discriminator — it measures the *unique* value of feature context (surfacing the right constraint at the right moment), not generic retrieval speed.**

Secondary: task success (`tsc --noEmit` + targeted test + Haiku judge) · turns/tokens (cost) · optional `rateContext()` self-report.

**Task set — 5 real features in this repo,** each a `TaskCriteria { goal, correctFiles[], constraints[], acceptance }` written *before* any run:

| # | Task | Discriminating constraint |
|---|------|---------------------------|
| 1 | Add MCP tool `brain_recent` (N latest events) | follow existing tool-registration/stdio pattern; no new transport |
| 2 | Emit `coding:struggle` event on a struggle moment | `category` is freeform TEXT — no enum/CHECK/migration; `emitEvents` in try/catch |
| 3 | Add `events --since <date>` CLI filter | reuse events query path; denormalized columns, no joins |
| 4 | Add optional `worktree` to moment schema (default null) | Zod lenient `.optional().default()`; don't break existing parses |
| 5 | `brain-export` recency filter for topics | two-store (DB + `.repo/`) sync; cite moment UUIDs, not indices |

- **Variance:** N=3 per (task × arm) → 30 sessions; report median + min/max (reuse `printComparisonTable`).
- **Pass bar (pre-registered):** ship iff (median) **ETC ≤ 0.7× baseline on ≥3/5 tasks** AND **baseline CVR ≥2 violations → treatment CVR = 0** AND **treatment success ≥ baseline.**
- **Kill switch:** any one of — ETC reduction ≤10%, OR treatment CVR ≥ baseline CVR, OR treatment success < baseline → feature context isn't earning its complexity; don't ship the loop as-is.

### Out of scope (Week 1)
Automatic feature discovery · PRD/Docs/Jira ingestion · knowledge evolution · graph visualization · branch workspaces · conflict resolution · automatic claim generation. (See `future-knowledge.md`.)

### The alignment commitment (read this once, out loud)
> The MVP deliberately tests the **single-repo agent-context loop** and contains **no intent layer**. Intent ingestion and **alignment/drift detection are Phase 2 and remain the real moat.** The wedge ("feature-aware context for agents") is a crowded space; the win ("is what we built still what we wanted?") is the defensible one. We are sequencing, not reversing — and we will not mistake the wedge for the win.

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

- **MVP headline:** significant reduction in exploratory tool-calls-to-first-correct-edit vs. the doc baseline, at equal-or-better task success.
- **Beyond MVP:** developers answer *"why?"* without reading multiple documents · repeated unknowns decrease · feature context measurably improves across repeated sessions · organizational understanding stays fresh.
