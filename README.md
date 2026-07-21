# Intent-AI

An organizational understanding engine (product name: **Quire**). It correlates
**intent** — what we want, as written in PRDs and product promises — with
**implementation** — what we have, as code and AI coding sessions — and serves
the current understanding to humans and agents.

One repository, two self-contained applications that share no code:

| App | Language | What it does |
|-----|----------|--------------|
| [`journal/`](journal/) | TypeScript | Watches AI coding sessions, digests them into a searchable journal of activity events, and serves feature context to agents (MCP server) and humans (web dashboard). Postgres. |
| [`alignment/`](alignment/) | Python | Reads a PR/diff against approved product obligations, decides keep/break, and fires quote-backed alarms when shipped behavior drifts from approved intent. FastAPI + CLI. SQLite. |

## Run the journal app

```bash
cd journal
npm install
npx tsx src/cli/index.ts up          # start Postgres (Docker, port 5433)
npx tsx src/cli/index.ts digest      # digest the latest Claude Code session
npx tsx src/cli/index.ts web --port 3456   # dashboard
npx vitest run                       # tests
```

## Run the alignment app

```bash
cd alignment
python3 -m pytest                    # tests (offline)
python3 -m quire_align.cli demo      # offline demo (canned LLM outputs)
python3 -m quire_align.cli serve --port 8321   # server + onboarding wizard
```

Both apps read credentials from the repo-root `.env` (see `.env.example`):
`ANTHROPIC_API_KEY`, `DATABASE_URL`, optionally LangSmith/GitHub keys.

## Read next

- [`docs/prd.md`](docs/prd.md) — product truth: vision, journal-as-product model, measurement.
- [`docs/architecture.md`](docs/architecture.md) — how both apps work, in plain English.
- [`docs/decisions/`](docs/decisions/) — dated decision records.
- [`CLAUDE.md`](CLAUDE.md) — entry point for coding agents.
