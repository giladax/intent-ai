# PR–Session Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans, task-by-task. Per founder preference (briefs-leave-room), tasks carry intent + invariants + exact interfaces — not verbatim code; the implementer designs the code. Checkbox steps track completion.

**Goal:** One evidence stream for development work — a PR and the coding sessions that produced it are coupled; analysis uses sessions when they exist and works identically when they don't. "The code and the session that created it. This is all about context and intent." (founder, 2026-07-21)

**Architecture:** Extend, don't invent: `quire/session.py` already ingests sessions as OBSERVED evidence with an explicit `--pr` coupling; commits in this repo already carry `Claude-Session:` trailers; the analysis ladder already resolves product context. This plan (1) makes the coupling first-class data (trailer-parsed + CLI-attached + correlation-proposed), (2) feeds coupled sessions into intent parsing and verdict evidence as *context, never authority*, (3) lands every analyzed check on the journal river so code-without-session is the same stream, thinner.

**Tech Stack:** Python backend (`backend/quire/`), Postgres (per migration Decision B), LangChain structured outputs, existing eval harnesses.

**Reasoning architecture:** how the analysis actually reasons over coupled evidence — refinement (digest-slices, never transcripts), the deterministic relation substrate + coverage map, the `coupled-v1` topology variant with context budgets, and the eval battery — is specified in `docs/specs/2026-07-21-session-code-reasoning-topology.md`. U2/U3 implement that spec; its eval cases C1–C6 extend the eval section here.

**Grounding (PRD):** *"Intent-evidence — what we want. Implementation-evidence — what we have (PR, coding session, code)"; "Alignment … falls out of holding both kinds of evidence under one node"* (docs/prd.md §Feature model). This feature is that sentence, made mechanical.

## Global Constraints

- **Invariants (binding, from the alignment core):** code never creates intent; sessions are OBSERVED evidence — they EXPLAIN a change, they never approve one, never mint obligations, never alter a deterministic label; similarity never grants authority; every citation validated verbatim; the LLM never decides final labels.
- **LLM standards (founder, 2026-07-21):** no naive string matching for semantic judgment. Structural facts (trailer syntax, path intersection, time overlap) are deterministic and sanctioned; "is this session about this change?" is an LLM structured-output judgment or it is not made.
- **EDD:** every LLM-touching task extends `backend/evals/` cases FIRST (new session-coupled fixture cases), runs offline canned before live; the 10-case alignment eval + fidelity suite stay green throughout.
- **Single-writer per table** (migration rule) holds; Postgres is truth for the new link data; `sessions.yaml` becomes a derived projection during the transition, never a second writer.
- **Meaning before mechanics:** every dev-facing surface reads as a sentence ("Reasoned in 2 sessions — the agent chose X over Y because…"); ids are footnotes.
- Green at every task; one commit per task; living docs updated in the task that changes what they describe. `backend/workspaces/quire-brain` untouched.

## Dependencies & sequencing (composability with the migration plan)

Runs AFTER migration Slices 5b + 6 (Python digestion is the production writer; daemon flows sessions continuously). Task U2+ also wants the alignment store's Postgres convergence (migration Decision B — lands with the store port); until then U0–U1's link table is Postgres-side and the yaml projection bridges. **Flags for the migration executor (do not edit its plan; ledger notes):** Slice 6's daemon already carries repo/branch — keep session git-context intact end-to-end; Slice 7's MCP `brain_enter` should leave room to serve coupled-check context; Slice 8's PR-facing surfaces will gain the "reasoned in sessions" line (U5).

---

### Task U0 — The coupling is data: link table + trailer parser

**Files:** Create `backend/quire/links.py`, `backend/tests/test_links.py`; extend `backend/quire/db/` models (new table `session_checks`).

**Interfaces:** Produces `SessionCheckLink {session_id: str, workspace: str, pr_number: int | None, base_sha: str, head_sha: str, kind: Literal["trailer","attached","inferred"], confidence: float, evidence: str}` and `links_for_check(ws, pr) -> list[SessionCheckLink]`, `links_for_session(session_id) -> list[SessionCheckLink]`.

- [ ] Failing tests first: trailer extraction from a real commit range in THIS repo (`Claude-Session: https://claude.ai/code/session_…` → session id; multi-commit PRs; commits without trailers), idempotent upsert, both query directions.
- [ ] Implement: deterministic trailer parse over `git log base..head` (structural — sanctioned); `session_checks` SQLAlchemy model + writer respecting single-writer; `kind="trailer"`, confidence 1.0, evidence = commit sha.
- [ ] `sessions.yaml` projection: existing `pr:` field read/written through the same link API (yaml stays consumable by current alignment code; one writer).
- [ ] Green + commit.

### Task U1 — Attach and propose: CLI + correlation

**Files:** Extend `backend/quire/cli.py` (`sessions` sub-group), create `backend/quire/correlate.py`, tests.

**Interfaces:** `quire.cli sessions attach <ws> <pr> <session-id|transcript>` (kind="attached"); `quire.cli sessions propose <ws> <pr>` → candidate list; `propose_couplings(ws, pr) -> list[SessionCheckLink]` with `kind="inferred"`.

- [ ] Correlation is mechanical-only: repo/branch match + session-window vs commit-time overlap + touched-path ∩ diff-file intersection → confidence score from structural facts. NO content similarity. Output reads as sentences ("Session 5b31a1bb edited 4 of this PR's 6 files during its commit window").
- [ ] Inferred links are proposals: stored with `kind="inferred"`, surfaced for confirmation (attach promotes to `attached`); they NEVER auto-promote (founder decision A below if this should ever change).
- [ ] Dev workflow doc: one section in backend/README — "couple a session to a PR" (trailer = automatic; attach = one line; propose = when you forgot).
- [ ] Green + commit.

### Task U2 — Sessions inform intent parsing (EDD)

**Files:** Extend `backend/quire/analysis/llm.py` (`parse_intent` gains optional `sessions` context), `nodes.py` (load coupled sessions before the parse node), `backend/evals/cases.py` + one new fixture workspace PR with a coupled session; canned outputs.

**Interfaces:** `parse_intent(pr, issue, sessions: list[SessionDigest] | None) -> DeclaredIntent` — session decisions/reasoning enter the prompt as clearly-labeled OBSERVED context ("the coding session that produced this change reasoned:…").

- [ ] Eval case first: a PR whose body is thin but whose coupled session states the intent explicitly — expected: DeclaredIntent captures it, labeled as session-derived; and an adversarial case: session reasoning contradicts an approved obligation — expected: intent parse reports the tension, classification UNCHANGED by the session (deterministic rules untouched).
- [ ] Ladder integrity: `ContextResolution` gains `session_context` (observed annotation) — NOT a rung, grants nothing; hard rules and abstain behavior byte-identical on all existing cases.
- [ ] Offline canned green → live EDD run on the 10 existing + 2 new cases; land at all-green.
- [ ] Green + commit.

### Task U3 — Sessions as verdict evidence

**Files:** Extend `backend/quire/analysis/evidence.py` (citation source: session transcript as source-of-record), `render.py` (comment cites session reasoning verbatim), eval evaluator for citation validity over transcripts; fixture.

- [ ] Every session quote in a verdict resolves verbatim against the transcript (same validator discipline as diff/artifact quotes); a finding on a session-coupled PR carries "the session reasoned…" context; deterministic labels unchanged (add annotation field `session_grounded: bool` if useful to reviewers — annotation, not verdict input).
- [ ] Green (incl. citation-validity evaluator) + commit.

### Task U4 — One river: every check is a journal event

**Files:** Extend the analysis persist/publish step to emit an `activity_events` row per completed check (`category="check:analyzed"`, repo/branch, summary sentence, metadata: verdict, pr, coupled session ids); two-way: session events ↔ check events joinable via `session_checks`.

- [ ] Code-only PRs thus land in the journal river exactly like session-coupled ones, minus the coupling — "digest code, no session" is this, not a pretend-session.
- [ ] Emit is failure-safe (never fails the analysis — existing emitEvents discipline); single-writer note: activity_events writer is Python post-migration-Slice-6; this task depends on that.
- [ ] Green + commit.

### Task U5 — Surfaces: the coupling is visible

**Files:** PR comment gains one sentence + drill block ("This change was reasoned in 2 sessions: …decisions…"); intent-ledger/navigator walk `check → session → reasoning` (exists for quire-brain — generalize); MCP: coupled-check context available to `brain_enter`-era tools (interface only; deep MCP work stays in migration Slice 7).

- [ ] Founder sees: a real PR in this repo analyzed with its real session, the comment reading as sentences, the ledger walking code → session → why.
- [ ] Living docs updated (architecture.md gains the one-river diagram note). Green + commit.

---

## Founder decisions — ALL RULED 2026-07-21

- **⚑ A — Inferred couplings: RULED — proposals forever.** Explicit trailer/attach is the only binding act; correlation never auto-promotes. "Similarity never grants authority" stays airtight.
- **⚑ B — Session visibility: RULED — per-workspace opt-in, ON for this repo.**
- **⚑ C — Surface language: RULED — "Reasoned in session…"** (meaning before mechanics; ids as footnotes).

## Honest unknowns

- Multi-session PRs (a change reasoned across 5 sessions): U2 prompt-context bounding needs a budget rule — propose: decisions from all, full reasoning from the most-overlapping session; validate in the U2 eval.
- Sessions from other tools (Codex etc.): out of scope; the link model is tool-agnostic (session_id + transcript source), the parser is not.
- Squash-merges drop individual commit trailers on some platforms — the PR-level trailer or attach path covers it; note in U1 docs.
