# 2026-07-21 — Monorepo reorg: two sibling apps, docs cut to the trunk

**Decided by:** founder, with the executing model proposing. Executed on
branch `feat/repo-brain`.

## The shape

The repo holds two ~equal codebases with zero shared code. The structure now
says so:

```
intent-ai/
├── README.md, CLAUDE.md
├── docs/          durable trunk only (prd, architecture, decisions, specs, handoffs)
├── journal/       TypeScript app — session digestion → Postgres → MCP + dashboard
└── alignment/     Python app — PR-vs-intent analysis → alarms (unchanged home)
```

- **By-app top level, not by flow-stage or front/back.** Flow-stage folders
  would cut across the TS app; a front/back template would flatten real
  decoupling. Rejected earlier: `ingestion/`/`analysis/` (insider jargon,
  wrong axis) and product-mythology names (no "Brain"/"Align" folders).
- **`journal/` as the TS app's name** — the plain word for what it builds: a
  journal of development activity (PRD's journal-as-product).
- Each app is self-contained: own toolchain, tests, datastore. The journal
  app always runs from `journal/` (data paths are cwd-anchored).

## Digestion stays TS for now — migration to Python is a later pass

The founder asked whether session digestion had already moved to Python.
Static analysis answer: only a lean distiller exists
(`alignment/quire_align/session.py`, parses CC transcripts directly, feeds
the alignment evidence map). The full journal pipeline (~8k LOC core:
adapters, pipeline, LLM layer, storage, MCP) is TS-only. **Ruling: reorg
now with truthful names; the migration is its own future pass** (re-baseline
the fidelity evals when it lands). The two-sibling shape already
accommodates it — journal/ would shrink toward the serving/dashboard app.

## Deleted from the tree (all recoverable via git history)

- `mockups/` (32MB design HTML/shots; founder-approved), `.superpowers/`
  (30MB SDD artifacts), `.repo/topics/` (excised Topic subsystem).
- `docs/`: archive (38), experiments (7), audits (12), plans (5, features
  shipped), superpowers sprint docs, superseded handoffs. Kept: prd,
  future-knowledge, specs (4 — code-referenced or still teaching),
  current handoff, this decisions dir.
- `.repo/brain.md` survives as `journal/eval-baseline/brain.md` (frozen
  measurement-v2 baseline).

## Deliberate non-changes / landmines honored

- Datastores stay split (Postgres/TS, SQLite/Python) — intentional debt.
- `alignment/workspaces/intent-ai/bindings.yaml` still binds historical
  `src/...` paths: correct for the pinned old commits it analyzes. Governing
  post-reorg commits requires a contract revision registering `journal/...`
  control points — deliberately not done silently.
- `alignment/workspaces/quire-brain` untouched (rehearsed demo).
- `journal/src/mcp/feature.ts` remains locally modified, never committed
  (standing rule).
- Docker Compose project pinned to `intent-ai` so the pre-move db volume
  keeps serving.
- Live eval harness handles both layouts (`appDirIn()`); its
  decontamination list covers pre- and post-reorg paths so old-base runs
  don't silently ship the answer key.
