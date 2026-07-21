# Intent-AI

An organizational understanding engine (product name: **Quire**). It correlates
**intent** — what we want, as written in PRDs and product promises — with
**implementation** — what we have, as code and AI coding sessions — and serves
the current understanding to humans and agents.

The repo is mid-migration to **one Python backend** that owns all reasoning
— session digestion, PR-vs-intent analysis, storage (Postgres), MCP, web API
— with TypeScript keeping only the dashboard UI (now `app/`). Status and
slice plan:
[`docs/plans/2026-07-21-python-backend-migration.md`](docs/plans/2026-07-21-python-backend-migration.md).

| Dir | Language | Today | Destination |
|-----|----------|-------|-------------|
| [`backend/`](backend/) | Python | THE backend: session digestion + watcher daemon, MCP brain server, dashboard web API + SPA serving (Slice 8), PR-vs-intent analysis + alarms, Postgres read/write layer | THE backend — everything |
| [`app/`](app/) | TypeScript (React) | The dashboard SPA — Vite dev server in development, built + served by FastAPI in production | Stays — the UI |
| [`journal/`](journal/) | TypeScript | MCP fallback only until Slice 9 (Express dashboard disconnected; vitest suites still cover in-tree TS until decommission) | Retired in Slice 9 |

## Run the app

```bash
cd backend
python3 -m pytest                        # tests (offline)
python3 -m quire.cli demo                # offline demo (canned LLM outputs)
python3 -m quire.cli serve --port 3456   # dashboard (SPA at /) + journal API
python3 -m quire.cli serve --port 8321   # alignment surfaces + onboarding wizard
# (one FastAPI app — both serve everything; ports are muscle memory)

cd ../app
npm install && npm run build             # build the SPA → backend/quire/static/dashboard/
npm run dev                              # or: Vite dev server, /api proxied to :3456
```

Postgres (Docker, port 5433) still starts from journal for now:
`cd journal && npx tsx src/cli/index.ts up`.

Both apps read credentials from the repo-root `.env` (see `.env.example`):
`ANTHROPIC_API_KEY`, `DATABASE_URL`, optionally LangSmith/GitHub keys.

## Read next

- [`docs/prd.md`](docs/prd.md) — product truth: vision, journal-as-product model, measurement.
- [`docs/architecture.md`](docs/architecture.md) — how both apps work, in plain English.
- [`docs/decisions/`](docs/decisions/) — dated decision records.
- [`CLAUDE.md`](CLAUDE.md) — entry point for coding agents.
