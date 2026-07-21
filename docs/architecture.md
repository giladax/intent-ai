# Architecture

**Target (founder-ruled 2026-07-21, migration executing):** ONE Python
backend owns all reasoning and serving — session digestion, PR-vs-intent
analysis, storage (Postgres), MCP, web API. TypeScript keeps only the
dashboard SPA. Sessions and PRs are two evidence streams into the same
brain: what was built (sessions) held against what was promised
(obligations).

```
 AI coding sessions ──┐
                      ├──▶ backend/ (Python) ──▶ journal + verdicts + alarms
 PRs / diffs        ──┘         │                        │
 approved intent ───────────────┘                        ├──▶ agents (MCP)
                                                         └──▶ app/ (React dashboard)
```

**Today (mid-migration):** digestion still physically runs in `journal/`
(TS) until its Python port lands slice by slice — see
`docs/plans/2026-07-21-python-backend-migration.md` for the slice status.
The sections below describe what runs WHERE right now.

```
 AI coding sessions ──▶ journal/ (TS)  ──▶ activity journal ──▶ agents (MCP) + dashboard
 PRs / diffs        ──▶ backend/ (Py)  ─▶ keep/break verdicts ─▶ alarms + intent ledger
                          ▲
                          └── approved product intent (PRDs, obligations)
```

## journal/ — the session journal (TypeScript)

Ingests Claude Code session logs and turns them into durable, searchable
understanding.

**Pipeline** (`src/pipeline/`): parse → normalize → classify → chunk →
extract "moments" → weave → verify → narrative → emit activity events. Each
step is an independent exported function that enriches a shared context;
deterministic steps and LLM steps (Sonnet for reasoning, Haiku for
classification) alternate. All domain types live in `src/adapters/types.ts`.

**Storage** (`src/storage/`): Postgres 16 (Docker, port **5433**) via Drizzle.
The spine is the `activity_events` table — every significant thing (session
moments, brain mutations, observations) as a time-ordered, self-contained,
searchable event. Time is the axis; search is the front door.

**Serving**:
- `src/mcp/` — MCP server (`intent-brain`); any agent can call `brain_enter`,
  `brain_search`, `brain_feature_context`, etc. mid-session.
- `src/web/` — Express API + React/Vite dashboard (`src/web/ui`, its own
  package.json): the journal river, Feature lenses, Correspondence chat.
- `src/daemon/` — background watcher that digests sessions continuously.

**Evals** (`src/eval/`, `run-fidelity.ts`, `run-mvp-eval.ts`): digest-fidelity
harness plus the measurement-v2 A/B harness (does brain context measurably
help a coding agent?). `eval-baseline/brain.md` is the frozen baseline
document for that measurement.

The app always runs from `journal/` — data dirs (`.intent/`, `eval-runs/`)
and Docker Compose resolve against its working directory.

## backend/ — product-to-code alignment (Python)

Given a PR (or any base..head commit range), decides whether the behavioral
change aligns with **approved** product intent. Not a code reviewer — a
behavioral-alignment checker.

**Analysis graph** (`quire/analysis/`): load PR → resolve product
context (a fixed authority ladder of intent sources) → parse declared intent
(Haiku) → infer behavioral delta (Sonnet, structured) → compare with
obligations → validate every citation verbatim → **deterministic rules pick
the final label** (the LLM never decides verdicts) → persist (SQLite) →
publish. UNKNOWN beats unsupported certainty.

**Around the core**: adapters (fixture, live GitHub, local git),
entity graph + relevance propagation, session ingestion
(`quire/session.py` distills a Claude Code transcript's reasoning into
workspace evidence), proactive alarms (`cli watch`) that tap the stakeholder
only on a quote-backed break, FastAPI server with onboarding wizard and the
intent ledger timeline.

**Workspaces** (`workspaces/`): each governed repo has manifest, obligations,
bindings, PR registry. `workspaces/quire-brain` is a rehearsed live demo —
never regenerate it. Evals live in `evals/` (LangSmith, deterministic
evaluators; offline by default).

## Seams being closed by the migration

All three seams below are scheduled for removal by
`docs/plans/2026-07-21-python-backend-migration.md`:

- **Two datastores** — RULED: converge on Postgres (SQLite retires with the
  backend store port). Until that slice lands, single-writer-per-table
  discipline holds.
- **Session digestion exists twice** — the full TS pipeline (`journal/`) and
  the lean distiller (`backend/quire/session.py`). The TS pipeline is being
  ported into `backend/quire/ingest/` (deterministic steps first,
  parity-gated; LLM steps fidelity-gated); TS digestion retires at cutover.
- **The dashboard** — the React SPA moves to `app/` and is served by
  FastAPI; the Express layer retires with the TS backend.
