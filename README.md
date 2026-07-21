# Intent-AI

An organizational understanding engine (product name: **Quire**). It correlates
**intent** — what we want, as written in PRDs and product promises — with
**implementation** — what we have, as code and AI coding sessions — and serves
the current understanding to humans and agents.

The repo is mid-migration to **one Python backend** that owns all reasoning
— session digestion, PR-vs-intent analysis, storage (Postgres), MCP, web API
— with TypeScript keeping only the dashboard UI. Status and slice plan:
[`docs/plans/2026-07-21-python-backend-migration.md`](docs/plans/2026-07-21-python-backend-migration.md).

| Dir | Language | Today | Destination |
|-----|----------|-------|-------------|
| [`backend/`](backend/) | Python | PR-vs-intent analysis + quote-backed alarms; Postgres read layer; session-ingestion port in progress | THE backend — everything |
| [`journal/`](journal/) | TypeScript | Still runs production session digestion → Postgres → MCP + dashboard | Retired slice by slice; only the React SPA survives (as `app/`) |

## Run the journal app

```bash
cd journal
npm install
npx tsx src/cli/index.ts up          # start Postgres (Docker, port 5433)
npx tsx src/cli/index.ts digest      # digest the latest Claude Code session
npx tsx src/cli/index.ts web --port 3456   # dashboard
npx vitest run                       # tests
```

## Run the backend app

```bash
cd backend
python3 -m pytest                    # tests (offline)
python3 -m quire.cli demo            # offline demo (canned LLM outputs)
python3 -m quire.cli serve --port 8321   # server + onboarding wizard
```

Both apps read credentials from the repo-root `.env` (see `.env.example`):
`ANTHROPIC_API_KEY`, `DATABASE_URL`, optionally LangSmith/GitHub keys.

## Read next

- [`docs/prd.md`](docs/prd.md) — product truth: vision, journal-as-product model, measurement.
- [`docs/architecture.md`](docs/architecture.md) — how both apps work, in plain English.
- [`docs/decisions/`](docs/decisions/) — dated decision records.
- [`CLAUDE.md`](CLAUDE.md) — entry point for coding agents.
