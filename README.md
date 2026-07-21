# Intent-AI

An organizational understanding engine (product name: **Quire**). It correlates
**intent** — what we want, as written in PRDs and product promises — with
**implementation** — what we have, as code and AI coding sessions — and serves
the current understanding to humans and agents.

| Dir | Language | What |
|-----|----------|------|
| [`backend/`](backend/) | Python | THE backend: session digestion + watcher daemon, MCP brain server, dashboard web API + SPA serving, PR-vs-intent analysis + alarms, Postgres read/write layer |
| [`app/`](app/) | TypeScript (React) | The dashboard SPA — Vite dev server in development, built + served by FastAPI in production |
| [`docs/`](docs/) | — | PRD, architecture, decision records, plans |

## Quickstart: backend

```bash
cd backend
docker compose up -d                     # start Postgres (port 5433)
python3 -m quire.cli journal digest <log> # ingest a CC session log
python3 -m quire.cli mcp                 # start MCP brain server (stdio, for agents)
python3 -m quire.cli serve --port 3456   # dashboard (SPA at /) + journal API
python3 -m quire.cli journal watch-sessions # watch for new CC session logs
```

## Quickstart: dashboard dev mode

```bash
cd app
npm install
npm run dev          # Vite dev server, /api proxied to backend :3456
npm run build        # build SPA → backend/quire/static/dashboard/ for production
```

## Tests

```bash
cd backend && python3 -m pytest          # 548 tests, offline
cd app && npm test                       # 28 vitest tests
```

Both apps read credentials from the repo-root `.env` (see `.env.example`):
`ANTHROPIC_API_KEY`, `DATABASE_URL`, optionally LangSmith/GitHub keys.

## Read next

- [`docs/prd.md`](docs/prd.md) — product truth: vision, journal-as-product model, measurement.
- [`docs/architecture.md`](docs/architecture.md) — how both apps work, in plain English.
- [`docs/decisions/`](docs/decisions/) — dated decision records.
- [`CLAUDE.md`](CLAUDE.md) — entry point for coding agents.
