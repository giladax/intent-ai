# Intent-AI (product name: Quire)

An organizational understanding engine: it correlates **intent** — "what we
want" (PRDs, product promises) — with **implementation** — "what we have"
(code and AI coding sessions) — and serves the current understanding to
humans and agents. The event river (Journal) is the substrate; Feature is the
primary lens; alignment ("is what we built still what we wanted?") is the
differentiator. Time is the axis, search is the front door; no trees, no
graph-viz UI.

**Product source of truth: [`docs/prd.md`](docs/prd.md)** (PRD v0.3.1).
System map: [`docs/architecture.md`](docs/architecture.md).

## Repo layout

```
backend/     Python — THE backend (everything). Session digestion + watcher
             daemon, MCP brain server, dashboard web API + SPA serving,
             PR-vs-intent analysis + alarms, Postgres read/write layer.
             See backend/README.md.
app/         TypeScript — the dashboard React SPA (Vite dev mode, or built
             and served by FastAPI in production).
docs/        durable trunk: prd, architecture, decisions/, specs/, handoffs/
```

Migration COMPLETE as of 2026-07-22. See
`docs/decisions/2026-07-22-python-backend-migration-complete.md`.

Both apps read credentials from the repo-root `.env` (see `.env.example`):
`ANTHROPIC_API_KEY`, `DATABASE_URL`, optionally LangSmith/GitHub keys.

## Standing rules (do not relitigate)

- **Never edit/regenerate `backend/workspaces/quire-brain`** — a rehearsed
  live demo.
- **Migration COMPLETE** — the TS backend (`journal/`) was deleted in Slice 9.
  All logic belongs in `backend/` (Python). See decision record above.
- (Retired 2026-07-21: the never-commit `feature.ts` rule — the standing
  delta landed as `94ee702`.)

# backend/ — the Python backend

Read `backend/README.md` first. From `backend/`:

```bash
docker compose up -d                             # start Postgres (Docker, port 5433)
python3 -m pytest                                # 548 tests, offline
python3 -m evals.event_stream && python3 -m evals.alarms  # both must say "all clear"
python3 -m evals.fidelity                        # fidelity eval (≥ TS baseline)
python3 -m quire.cli demo                        # offline demo (canned LLM outputs)
python3 -m quire.cli serve --port 3456           # dashboard + journal API
python3 -m quire.cli serve --port 8321           # alignment surfaces
# SPA (production): http://localhost:3456/
# SPA (dev): cd ../app && npm run dev  (proxies /api → 3456)

# Ingestion
python3 -m quire.cli journal digest <log>        # full digest (parse + LLM + persist)
python3 -m quire.cli journal digest <log> --dry-run   # deterministic only, no LLM
python3 -m quire.cli journal digest <log> --offline   # offline (canned LLM, CI/tests)
python3 -m quire.cli journal events              # query activity event stream
python3 -m quire.cli journal watch-sessions      # watch for new CC session logs

# MCP brain
python3 -m quire.cli mcp                         # start MCP brain server (stdio)
```

## Architecture

**Pipeline** (`quire/ingest/` + `quire/understand/`): CC log → parse →
normalize → classify → chunk → extract "moments" → weave → verify →
transitions → narrative → emit activity events. Deterministic steps and LLM
steps (Sonnet for reasoning/moments/narrative, Haiku for classification)
alternate; each step enriches shared context, never replaces upstream data.

**Spine**: `activity_events` table in Postgres 16 (Docker, port **5433**) —
every significant thing as time-ordered, self-contained, searchable events with
freeform categories/tags. Schema in `quire/db/models.py`, managed by SQLAlchemy.
Postgres schema is frozen as inherited from Drizzle migrations at tag
`ts-backend-final`; future schema changes start by adopting Alembic.

**Key paths**: `quire/ingest/` (deterministic pipeline), `quire/understand/`
(LLM stage), `quire/journal/` (emit_events, watcher, feed, router),
`quire/mcp/` (brain MCP server), `quire/analysis/` (PR-vs-intent),
`quire/db/` (SQLAlchemy models + writer), `quire/cli.py` (all CLI commands).

## Conventions

- Python 3.11+; Pydantic for LLM output schemas; no classes for pipeline steps
  (functions only); pytest + canned LLM (`quire/canned.py`) for offline tests;
  EDD (eval criteria before code) for any prompt change.
- **NO regex for behavioral/semantic classification** — use Haiku with
  structured output. Regex is fine for structural parsing (IDs, paths, JSON).
- **The LLM never decides the final label** — deterministic rules in
  `analysis/classify.py` pick verdicts; the model contributes evidence only.
- **Archive before parsing**: `journal digest` archives the raw log at step 0
  before any parse or LLM call; evidence must survive a failed digest.
- Emitting events from a new source: build `ActivityEvent`s (freeform
  `category`, `tags`, `actor`, `summary`, `metadata`), call `emit_activity_events()`
  in try/catch — never fail the parent operation.

## Eval workflow (EDD)

Write eval criteria FIRST, run baseline, inspect actual output, THEN change
code. Fidelity: `python3 -m evals.fidelity` (scores ≥ pinned baseline in
`evals/baselines/2026-07-21-ts-fidelity.md`). This applies to any LLM prompt
change, not just code. Re-run the 8× stability sweep after any prompt or
contract change.

# app/ — the dashboard SPA (TypeScript/React)

```bash
cd app
npm install
npm run dev      # Vite dev server, /api proxied to backend :3456
npm run build    # build → backend/quire/static/dashboard/ for production
npm test         # 28 vitest tests
npm run typecheck  # tsc --noEmit
```

No business logic — pure UI over the backend REST API. Tests run standalone
(no backend required).

# Agent skills (`.claude/skills/agents/`)

Structured guides for pipeline work: `playbooks/` (procedures),
`strategies/` (optimization approaches), `schemas/` (output contracts),
`topologies/` (graph patterns), `experiments/` (templates). Changing how
nodes connect → `topologies/`; changing what a node does → `strategies/`;
running an eval experiment → `playbooks/`.

# Reference

| Document | What |
|----------|------|
| `docs/prd.md` | Product source of truth (v0.3.1). Read first. |
| `docs/architecture.md` | Both apps in plain English. |
| `docs/decisions/` | Dated decision records (append-only history). |
| `docs/future-knowledge.md` | Consciously deferred hypotheses. |
| `docs/specs/` | Kept design specs (measurement-v2, brain API, execution memory, event backbone). |
| `docs/handoffs/` | Session handoffs for continuity. |
