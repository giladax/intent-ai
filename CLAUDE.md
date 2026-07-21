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

## Repo layout — mid-migration to ONE Python backend

```
backend/     Python — THE backend (target: everything). Today: PR-vs-intent
             analysis + alarms, Postgres read layer (db/), session-ingestion
             port in progress (ingest/). See backend/README.md.
journal/     TypeScript — BEING RETIRED slice by slice. Still runs production
             session digestion → Postgres → MCP + dashboard until its Python
             replacements land. Do NOT add new backend logic here.
docs/        durable trunk: prd, architecture, decisions/, specs/, handoffs/
```

**Migration status lives in `docs/plans/2026-07-21-python-backend-migration.md`**
— read it before deciding where anything new belongs. End-state: `backend/`
(Python, all logic) + `app/` (React SPA) + `docs/`.

Both sides read credentials from the repo-root `.env` (see `.env.example`).
**Run each side from its own directory** — data paths and Docker resolve
against the working directory.

## Standing rules (do not relitigate)

- **Never edit/regenerate `backend/workspaces/quire-brain`** — a rehearsed
  live demo.
- **The full backend migrates to Python** — planned and founder-ruled; the
  executable plan is `docs/plans/2026-07-21-python-backend-migration.md`.
  End-state: `backend/` (Python, everything) + `app/` (React SPA) + `docs/`.
  Datastores converge on Postgres per that plan (single-writer-per-table
  during the migration; don't unify ahead of the plan's slices).
- (Retired 2026-07-21: the never-commit `feature.ts` rule — the standing
  delta landed as `94ee702`.)

# journal/ — the TypeScript app

## Commands (from `journal/`)

```bash
npm install
npx tsx src/cli/index.ts up          # start Postgres (Docker, port 5433)
npx tsx src/cli/index.ts digest      # digest latest CC session
npx tsx src/cli/index.ts digest --dry-run    # deterministic pipeline only, no LLM
npx tsx src/cli/index.ts mcp         # MCP server (stdio; wired via root .mcp.json)
npx tsx src/cli/index.ts web --port 3456     # dashboard
npx tsx src/cli/index.ts events      # query the activity event stream
npx tsx src/cli/index.ts observe-events      # observation layer over recent events

npx vitest run                       # tests (some need Postgres up)
npx tsc --noEmit                     # type check
npm run typecheck:ui                 # type check the React SPA
npx tsx run-fidelity.ts              # fidelity eval (measurement-v2 baseline)
```

## Architecture

Pipeline: CC log → parse → normalize → [classify + chunk + analyze] →
sittings → chunks → extract → weave → verify → transitions → narrative →
emit events. Deterministic steps and LLM steps (Sonnet for reasoning/moments/
narrative, Haiku for classification/critics/routing) alternate; each step
enriches a shared context, never replaces upstream data. **All domain types
live in `src/adapters/types.ts` — read it before modifying any pipeline
step.**

The spine is the `activity_events` table: every significant thing (session
moments, brain mutations, observations) as time-ordered, self-contained,
searchable events with freeform categories/tags. Postgres 16 via Docker on
port **5433**, schema in `src/storage/schema.ts`, migrations in `drizzle/`.

Source: `src/pipeline/` (steps as functions, orchestrator.ts runs them),
`src/llm/` (SDK wrapper + prompt builders), `src/storage/`, `src/mcp/`
(Feature-keyed brain tools), `src/web/` (Express + React SPA in
`src/web/ui`), `src/daemon/`, `src/eval/`, `src/cli/`.
`eval-baseline/brain.md` is the frozen measurement-v2 baseline document.

## Conventions

- TypeScript ESM; `.js` extensions in imports; no classes — pipeline steps
  are exported functions; Vitest; Zod for LLM output validation (lenient:
  `.optional().default()`, `.passthrough()`).
- **NO regex for behavioral/semantic classification** — use Haiku with
  structured output. Regex is fine for structural parsing (IDs, paths, JSON).
- Emitting events from a new source: build `ActivityEvent`s (freeform
  `category`, `tags`, `actor`, `summary`, `metadata`), call `emitEvents()`
  from `src/storage/queries.ts` in try/catch — never fail the parent
  operation.

## Eval workflow (EDD)

Write eval criteria FIRST, run baseline, inspect actual output, THEN change
code. Fixtures in `tests/eval/fixtures/`, criteria in
`tests/eval/fidelity-criteria.ts`, harness in `src/eval/fidelity.ts`.
This applies to any LLM prompt change, not just code.

# backend/ — the Python app

Read `backend/README.md` first — it carries the full picture. From
`backend/`:

```bash
LANGCHAIN_TRACING_V2=false LANGSMITH_TRACING=false python3 -m pytest   # 229 tests, offline
python3 -m evals.event_stream && python3 -m evals.alarms               # both must say "all clear"
python3 -m quire.cli demo            # offline demo
python3 -m quire.cli serve --port 8321   # server + onboarding wizard
```

Key invariants: the LLM never decides the final label (deterministic rules in
`analysis/classify.py` do); code never creates intent; every citation is
validated verbatim; UNKNOWN beats unsupported certainty. Re-run the 8×
stability sweep after any prompt or contract change.

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
