# Architecture

ONE Python backend owns all reasoning and serving — session digestion,
PR-vs-intent analysis, storage (Postgres), MCP, web API. TypeScript keeps
only the dashboard SPA. Sessions and PRs are two evidence streams into the
same brain: what was built (sessions) held against what was promised
(obligations).

```
 AI coding sessions ──┐
                      ├──▶ backend/ (Python) ──▶ journal + verdicts + alarms
 PRs / diffs        ──┘         │                        │
 approved intent ───────────────┘                        ├──▶ agents (MCP)
                                                         └──▶ app/ (React dashboard)
```

Migration complete as of Slice 9 (2026-07-22). Decision record:
`docs/decisions/2026-07-22-python-backend-migration-complete.md`.

## backend/ — the single backend (Python)

All reasoning and serving converges here. Two main domains:

### Session journal (`quire/ingest/`, `quire/understand/`, `quire/journal/`, `quire/mcp/`)

Ingests Claude Code session logs and turns them into durable, searchable understanding.

**Pipeline**: parse → normalize → classify → chunk → extract "moments" → weave →
verify → narrative → emit activity events. Deterministic steps (ingest) and LLM
steps (Sonnet for reasoning, Haiku for classification) alternate. All domain types
live in `quire/ingest/types.py`.

**Storage**: Postgres 16 (Docker, port **5433**) via SQLAlchemy. The spine is
the `activity_events` table — every significant thing (session moments, brain
mutations, observations) as a time-ordered, self-contained, searchable event.
Time is the axis; search is the front door.

**Serving**:
- `quire/mcp/` — Python MCP server (`intent-brain`, 12 `brain_*` tools, stdio
  transport). Entry in root `.mcp.json`.
- `quire/journal/router.py` — FastAPI router: 35 REST routes serving the SPA
  (journal river, Feature lenses, Correspondence chat, feed).
- `quire/journal/watcher.py` — session watcher daemon (`watch-sessions` command).

**Evals** (`evals/`): fidelity harness scores live digests ≥ the pinned
TS baseline (`evals/baselines/2026-07-21-ts-fidelity.md`). The measurement-v2
frozen baseline document lives at `evals/baselines/measurement-v2-brain-baseline.md`
(TS harness retrievable at git tag `ts-backend-final`).

**Commands**:
```bash
python3 -m quire.cli journal digest <log>   # full digest (parse + LLM + persist)
python3 -m quire.cli journal digest <log> --dry-run  # deterministic only, no LLM
python3 -m quire.cli journal watch-sessions # watch for new CC session logs
python3 -m quire.cli mcp                    # start MCP brain server (stdio)
python3 -m quire.cli serve --port 3456      # dashboard + journal API
python3 -m evals.fidelity                   # run fidelity eval
python3 -m evals.event_stream               # event-stream eval
python3 -m evals.alarms                     # alarms eval
```

**Postgres** (Docker Compose, port 5433): `docker compose up -d` from `backend/`.
Schema frozen as inherited from Drizzle migrations (tag `ts-backend-final`); any
future schema change starts by adopting Alembic.

### PR-vs-intent analysis (`quire/analysis/`, `quire/adapters/`)

Given a PR (or any base..head commit range), decides whether the behavioral
change aligns with **approved** product intent. Not a code reviewer — a
behavioral-alignment checker.

**Analysis graph**: load PR → resolve product context (a fixed authority ladder
of intent sources) → parse declared intent (Haiku) → infer behavioral delta
(Sonnet, structured) → compare with obligations → validate every citation
verbatim → **deterministic rules pick the final label** (the LLM never decides
verdicts) → persist → publish. UNKNOWN beats unsupported certainty.

**Workspaces** (`workspaces/`): each governed repo has manifest, obligations,
bindings, PR registry. `workspaces/quire-brain` is a rehearsed live demo —
never regenerate it. Evals live in `evals/` (LangSmith, deterministic
evaluators; offline by default).

## app/ — dashboard SPA (TypeScript/React)

React + Vite + Tailwind. In dev mode (`npm run dev`) the Vite server proxies
`/api` to the backend on port 3456. In production, `npm run build` emits the
SPA into `backend/quire/static/dashboard/`, which FastAPI serves.

No business logic lives here — it is a pure UI over the backend's REST API.
