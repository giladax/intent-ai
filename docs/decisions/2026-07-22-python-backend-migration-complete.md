# Decision: Python Backend Migration Complete (2026-07-22)

**Author**: Gilad Koch  
**Status**: Complete  
**Supercedes**: `docs/plans/2026-07-21-python-backend-migration.md` (plan phase closed)

## What happened

The TypeScript backend (`journal/`) was deleted in Slice 9 (this commit). The
Python backend (`backend/`) now owns everything. The repo root reads:
`app/` + `backend/` + `docs/`.

## What moved where

| TS artifact | Python equivalent | Status |
|-------------|-------------------|--------|
| `journal/src/adapters/` (CC log parser) | `backend/quire/ingest/transcript.py` | Ported, parity-gated |
| `journal/src/pipeline/` (deterministic steps) | `backend/quire/ingest/` | Ported, parity-gated |
| `journal/src/pipeline/understand/` (LLM) | `backend/quire/understand/` | Ported, fidelity-gated |
| `journal/src/storage/` (Drizzle + queries) | `backend/quire/db/` (SQLAlchemy) | Ported, single-writer |
| `journal/src/mcp/server.ts` (brain MCP) | `backend/quire/mcp/server.py` | Ported, golden-tested |
| `journal/src/web/server.ts` (Express API) | `backend/quire/journal/router.py` (FastAPI) | Ported, 33 routes |
| `journal/src/web/feed-composer.ts` | `backend/quire/journal/feed.py` | Ported, Slice 8b |
| `journal/src/daemon/` (TS watcher) | `backend/quire/journal/watcher.py` | Ported, Slice 6 |
| `journal/src/web/ui/` (React SPA) | `app/` | Moved, Slice 8 |
| `journal/docker-compose.yml` | `backend/docker-compose.yml` | Moved (git mv), Slice 9 |
| `journal/eval-baseline/brain.md` | `backend/evals/baselines/measurement-v2-brain-baseline.md` | Moved (git mv), Slice 9 |
| `journal/eval-runs/` (untracked) | `backend/evals/eval-runs/` | Moved (mv), Slice 9 |
| `journal/` everything else | — | Deleted |

## Gates that held

All of the following were green before the deletion commit:

- **parity suite** (`python3 -m pytest backend/tests/test_ingest_parity.py`) — byte-identical
  deterministic output across all corpus fixtures.
- **fidelity re-pin** (`python3 -m evals.fidelity`) — Python scores ≥ TS baseline
  in `evals/baselines/2026-07-21-ts-fidelity.md`.
- **MCP golden tests** (`python3 -m pytest backend/tests/test_mcp_golden.py`) — byte-identical
  tool responses recorded against the TS server.
- **feed mandate** — `GET /api/feed` runs full LLM composition with cache (not a stub).
- **backend pytest** — 551 passed, 1 skipped (final count at merge review).
- **app vitest** — 28 passed (standalone, no backend required).
- **evals.event_stream** + **evals.alarms** — both "all clear".

## Freezes

- **measurement-v2 harness** — frozen at git tag `ts-backend-final`. The harness
  itself (`journal/run-fidelity.ts`, `journal/src/eval/fidelity.ts`) is retrievable
  from that tag. The frozen baseline document is kept in-tree at
  `backend/evals/baselines/measurement-v2-brain-baseline.md` with a freeze header.
  Git history is the archive; the tag gives the harness a durable name.
  
- **Drizzle schema** — the Postgres schema is frozen as inherited from Drizzle
  migrations at tag `ts-backend-final`. No Drizzle is present in the repo.
  Any future schema change starts by adopting Alembic. See
  `backend/quire/db/CENSUS.md` "Drizzle/schema ownership" section.

- **Dogfood workspace** (`backend/workspaces/quire-brain`) — a rehearsed live demo
  workspace: never edit or regenerate it. The workspace's pinned old commits reference
  binding targets in the deleted TypeScript backend; git history holds them (tag
  `ts-backend-final`).

## Residual follow-ups (named, not yet implemented)

1. **Compose parallelization** — `backend/quire/journal/feed.py` runs up to 3 Sonnet
   calls sequentially (~10 s cold). Switch to `ThreadPoolExecutor(max_workers=3)`
   for ~3× speedup.

2. **Markdown-insensitive anchor matcher** — fidelity anchor matching is now a
   single-stack concern; a proper markdown-insensitive matcher (strip formatting,
   normalize whitespace) would reduce false-negative fidelity misses. Previously
   noted as a "both-stacks" concern — now owned entirely by the Python fidelity
   harness (`backend/evals/fidelity/scorers.py`).

3. **Mid-digest resume / parse-time stamping** — the watcher re-digests from scratch
   on resumption; parse-time stamping would enable incremental digests.

4. **Latency baseline** — end-to-end digest latency against TS not benchmarked.

5. **Alignment store → Postgres** — the alignment subsystem still uses SQLite;
   migration to the shared Postgres is the ruled next step (single datastore).

## What's unblocked next

- **PR-session unification plan** — now that the single Python backend owns both
  session digestion and PR analysis, the two evidence streams (what was built ×
  what was promised) can be surfaced in a unified view. The plan was gated on
  the migration completing.
  
- **Reasoning topology spec** — the understanding stage's LangChain call graph
  can now be restructured (e.g. parallel Sonnet calls for extract/weave, Haiku
  routing) without TS coordination concerns. Compose parallelization
  (follow-up 1 above) is the first candidate.
