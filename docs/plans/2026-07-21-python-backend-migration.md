# Python Backend Migration Plan

> **For agentic workers:** execute slice-by-slice (superpowers:subagent-driven-development or executing-plans). Every slice lands green and founder-visible before the next starts. Task specs here carry intent + invariants + gates, not verbatim code — the executor designs the code (briefs-leave-room, founder directive).

**Goal:** One Python backend owns all reasoning, storage, and serving; TypeScript shrinks to the React app. Ends the two-LLM-stack debt (founder directive, 2026-07-21).

**Architecture:** Strangler migration. The Python world (today `alignment/`, becomes `backend/`) grows organ by organ — parsing → deterministic pipeline → storage → LLM steps → MCP → web API — behind parity and fidelity gates, while the TS backend keeps running until each organ is replaced. Nothing is deleted until its replacement is proven against evals.

**Tech stack:** Python 3.11+, LangChain/LangGraph (already pinned in `backend/requirements.txt`), Pydantic v2, SQLAlchemy 2 + Postgres 16 (existing instance, port 5433), official `mcp` Python SDK (FastMCP), FastAPI (already in use), pytest + canned-LLM offline tests (existing pattern), LangSmith evals.

## Founder summary (read this, skip the rest)

The journal's brain moves into the Python world, one green slice at a time, with the digest-quality eval as the tripwire — a slice that makes digests worse cannot land. At the end: `backend/` (Python, everything), `app/` (the dashboard UI, TypeScript), `docs/`. You react between slices. **All three founder decisions were ruled 2026-07-21** (details at each ⚑): the `feature.ts` local change is now committed (`94ee702`), measurement-v2 freezes rather than ports, and Postgres is confirmed as the one database.

## Global constraints

- Green at every slice: `backend` pytest suite (229 today, grows) + `python3 -m evals.event_stream` + `python3 -m evals.alarms` all clear; journal `npx vitest run` (815) stays green until the slice that explicitly retires the covered code.
- `alignment/workspaces/quire-brain` (→ `backend/workspaces/quire-brain`) is a rehearsed demo — never edit/regenerate.
- ~~`journal/src/mcp/feature.ts` standing uncommitted modification~~ — resolved: committed as `94ee702` (2026-07-21); the dirty-file rule is retired and Slice 7 ports committed behavior only.
- One commit per slice, trailers per repo convention; archive-over-delete (git history is the net).
- LLM discipline is the alignment discipline: deterministic core, LLM at the edges, structured Pydantic outputs, canned-LLM offline tests, EDD (eval criteria before code) for every prompt.
- No datastore writes from two stacks to the same table in the same phase (each table has exactly one writer at any time; the plan says who, when).

---

## Inventory — what each piece of `journal/src/` becomes

| Piece (LOC) | Fate | Where / how |
|---|---|---|
| `adapters/` CC parsing (484) | **Re-implement thin** | `backend/.../ingest/transcript.py` — extend the proven ~90-line parser in `session.py`; see Decision A |
| `pipeline/` + `llm/prompts/` (3.8k + prompts) | **Port** | deterministic steps as pure functions (parity-gated); LLM steps re-built on LangChain + canned outputs (fidelity-gated) |
| `llm/client.ts` (233) | **Drop** | superseded by the existing LangChain layer + `llm_retry.py` |
| `storage/` (1.4k, 33 Drizzle tables) | **Port the live subset** | SQLAlchemy models against the *same* Postgres schema; excised-Topic tables (`topics`, `insights`, `brain_versions`, `brain_cards`, …) are ported only if a reader is proven live (verify in Slice 2 — they were flagged live 2026-07-21, so verify, don't assume dead) |
| `mcp/` (1.4k, 12 `brain_*` tools) | **Port** | FastMCP server, same tool names/contracts, golden-transcript tests |
| `web/server.ts` (Express, 34 routes) | **Port** | FastAPI router(s); FastAPI serves the built SPA |
| `web/ui/` (React SPA) | **Keep TS** | becomes `app/`; Vite dev-proxy to FastAPI in dev |
| `daemon/` (926) | **Re-conceive** | Python `watchdog` file-watcher, small; don't port TS process machinery |
| `agents/` (1.7k, digest agent) | **Re-conceive** | LangGraph (harness + skills already in-house); evaluate what it adds over the pipeline before rebuilding — may shrink |
| `eval/` fidelity harness | **Port early** | it is the gate for the LLM-step slices (Slice 5a) |
| `eval/` measurement-v2 + `run-mvp-eval.ts` | **⚑ Decision 2** | keep as frozen TS tooling until retired; do not port |
| `cli/` (893) | **Re-conceive** | Typer commands folded into the existing backend CLI |
| `run-fidelity.ts`, `scripts/` | **Port with 5a / drop** | snapshot scripts stay TS with the app |

## Decisions

### Decision A — transcript parsing (recommended, executor may proceed)

**Own the thin parser; adopt `claude-code-log` only when a second provider becomes real.** Evidence: (1) the whole TS consumption is 4 event kinds (`conversation_turn`, `tool_result`, `ai_response`, `tool_call`) + raw passthrough — 87 lines over claude-code-kit; (2) `backend/quire_align/session.py::read_transcript` already parses CC JSONL natively in ~90 lines, in production; (3) `claude-code-log` 1.5.0 (active, July 2026) has `parser.py`/`models.py`/`providers/` but its importable API is CLI-internal and undocumented — pinning to a CLI's internals trades our churn for theirs; (4) `claude-code-analytics` is 0.1.1, pre-mature. **Shape:** one interface `parse_transcript(path) -> list[RawDevEvent]` in `ingest/`, hand parser as the default implementation, provider packages as future implementations behind the same interface. The official docs' warning (format changes between CC versions) is answered by the parity corpus in Slice 2 — schema drift breaks a test, not production.

### Decision B — datastore: converge on Postgres (⚑ **CONFIRMED by founder 2026-07-21**)

Postgres via SQLAlchemy for the unified backend; SQLite retires with the alignment store port. Why this direction and not the reverse: `activity_events` is the product substrate (search is the front door — needs real indexing, concurrent readers: daemon + web + MCP at once); the journal's 33 tables and all product data are already there; SQLite was justified in the alignment MVP explicitly as "no Python ORM exists" — SQLAlchemy removes the premise; `store.py` is 173 lines, the cheapest port in the whole plan. Workspace truth (obligations, bindings, `prs.yaml`) **stays in YAML files** — they are signed contract artifacts, not rows. Tests keep using SQLite-in-memory or a test Postgres schema — executor's call.

### Decision C — who serves the SPA

FastAPI serves the built SPA (`StaticFiles`) in production; `app/` keeps a Vite dev server proxying `/api` in development. TS keeps zero server code.

### ⚑ Decision 1 (**RESOLVED 2026-07-21**): `journal/src/mcp/feature.ts` local change

The delta turned out to be a real fix (ambiguous feature resolution now serves the top candidate's constraints inline — post-mortem 2026-07-07). Founder ruled: commit it. Landed as `94ee702`; Slice 7 simply ports committed behavior. No dirty-file handling remains in this plan.

### ⚑ Decision 2 (**RESOLVED 2026-07-21 — freeze, don't port**): measurement-v2 harness fate

It spawns real `claude` sessions to A/B brain context (ETC/CVR). Porting it is real work with no product payoff; keeping it TS keeps a vitest dependency alive. Recommendation: freeze it (and `eval-baseline/brain.md`) as-is until the next measurement campaign is actually scheduled, then decide port-vs-rerun-design. It is the only thing that keeps `journal/` TS tests alive after Slice 8 — retiring it lets the TS backend delete completely.

---

## Slices

Gates named once here, referenced by slice: **[PY]** backend pytest + both evals all clear · **[TS]** journal `npx vitest run` green + `typecheck:ui` · **[PARITY]** the slice's parity test corpus passes · **[FIDELITY]** ported fidelity eval ≥ recorded TS baseline.

### Slice 0 — Pin the baseline (no code moves)

Run the TS fidelity eval (`npx tsx run-fidelity.ts`) and record scores + artifacts into `backend/evals/baselines/2026-07-XX-ts-fidelity.md`; snapshot `--dry-run` deterministic outputs for ~6 representative fixture sessions (existing `tests/eval/fixtures/` + 2–3 real `.intent/raw-sessions/` logs) into a parity corpus dir. Document the `RawDevEvent`/`NormalizedEvent` contracts (from `src/adapters/types.ts`) as the port's interface spec. **Done when:** baseline doc + corpus committed. Gates: [TS], [PY].

### Slice 1 — `alignment/` → `backend/`, package `quire_align` → `quire`

Pure mechanical rename (git mv + import rewrite + config/path fixes: pytest.ini, evals, workspaces paths, root README/CLAUDE.md/architecture.md, `.claude` settings if any). quire-brain workspace content untouched by the rename tooling (paths in it may reference nothing that moves — verify with grep before and after). **Done when:** founder sees `backend/` at root. Gates: [PY], [TS].

### Slice 2 — Postgres foundation + live-table census

`backend/quire/db/` (SQLAlchemy 2) modeling only the tables the census proves live: instrument with a grep census of `journal/src` readers/writers per table (schema.ts's 33), recorded in the slice's commit message. Read-only proof: `python -m quire.cli journal events --recent` lists `activity_events` from Postgres. No writes yet. **Done when:** census table + working read CLI. Gates: [PY], [TS].

### Slice 3 — Ingestion + deterministic pipeline, parity-gated

`backend/quire/ingest/`: `parse_transcript()` (Decision A) + ports of the deterministic steps (normalize + threading, chunk, sittings, deterministic parts of analyze) as pure functions. Parity harness: for the Slice-0 corpus, Python output ≡ TS `--dry-run` snapshots (event counts, types, ids, chunk/sitting boundaries; allow a documented whitelist of intentional diffs, empty at start). **Done when:** `python -m quire.cli journal digest --dry-run <log>` matches TS stats on the corpus. Gates: [PY], [TS], [PARITY].

### Slice 4 — Python writes the journal (storage cutover for ingestion tables)

Python digestion writes `raw_events`/`normalized_events`/`chunks`/`sittings` (+ `sessions`) to Postgres via SQLAlchemy — same schema, no Drizzle migration. Single-writer rule: from this slice, TS `digest` is demoted to read-only paths (CLI still works for `web`/`mcp`; its digest command prints a deprecation pointer). Drizzle remains the migrations owner until Slice 9. **Done when:** a real session digested end-to-deterministic-end from Python lands in Postgres and the TS dashboard renders it. Gates: [PY], [TS], [PARITY] re-run.

### Slice 5a — Port the fidelity harness first (the gate before the risk)

`backend/evals/fidelity/`: port criteria + judge harness (LangSmith optional, offline-capable like the alignment evals). Calibration gate: run the ported harness against the *existing TS-produced* digests of the baseline corpus — scores must reproduce the Slice-0 baseline within a stated tolerance; that proves the gate itself before it gates anything. **Done when:** calibration documented. Gates: [PY], [TS].

### Slice 5b — LLM steps on LangChain, fidelity-gated (the heart)

Port classify/extract/weave/verify/transitions/narrative as LangChain-structured steps with canned outputs for offline tests; prompts translated with EDD (criteria first — the ported fidelity harness). Iterate until [FIDELITY] (≥ TS baseline; regressions documented per EDD loop, like alignment's 69→90/90 history). Live-inference budget required — surface to founder before spending. **Done when:** full Python digest of the corpus scores ≥ baseline. Gates: [PY], [TS], [FIDELITY].

### Slice 6 — Digestion cutover + daemon re-conceived

Python `digest` becomes the production writer (moments/narrative/activity_events tables switch writer in this slice); Python `watchdog` watcher replaces the TS daemon (small, own module, `quire.cli watch-sessions`). TS pipeline/daemon code stays in-tree but disconnected (deleted in Slice 9). **Done when:** the daemon digests a fresh real session unattended; founder sees it on the dashboard. Gates: [PY], [TS], [FIDELITY] spot-run.

### Slice 7 — MCP server in Python (Decision 1 already resolved — port committed behavior)

FastMCP server exposing the same 12 `brain_*` tools with identical names/argument contracts; golden tests: for each tool, recorded request → response shape assertions (build goldens against the TS server before switching). Root `.mcp.json` flips to the Python server; TS MCP stays runnable one slice as fallback. Instrumentation (`mcp` reads → activity_events) ports with it. **Done when:** a live agent session uses the Python brain end-to-end. Gates: [PY], [TS], golden suite.

### Slice 8 — Web API in FastAPI; the SPA moves to `app/`

Port the 34 Express routes to FastAPI routers (route census first; drop routes the SPA provably never calls — census in commit message); FastAPI serves the built SPA (Decision C). `journal/src/web/ui` → `app/` with its own package.json (it already has one); Vite dev proxy documented in `app/README`. Express + `web/server.ts` disconnected. **Done when:** dashboard fully served by Python; playwright snapshot scripts pass against it. Gates: [PY], SPA smoke, `typecheck:ui` (now in `app/`).

### Slice 9 — Decommission (⚑ Decision 2 resolved)

Delete the TS backend (`journal/src` minus anything Decision 2 keeps, tests, drizzle configs per migration-ownership handoff to Alembic or documented freeze), fold survivors, rename remnants: end state `backend/`, `app/`, `docs/`. Rewrite README/CLAUDE.md/architecture.md; decision record `docs/decisions/` for the migration; memory updates. **Done when:** root reads `app/ backend/ docs/`; everything green. Gates: [PY], app build + smoke, final fidelity run recorded.

---

## Honest unknowns (executor: verify, don't assume)

- **Topic-era tables**: flagged *live* on 2026-07-21 (MCP/web readers). The Slice-2 census decides port vs drop per table — the excised-subsystem history makes them look dead; the flag says otherwise. Trust the census.
- **`agents/` digest agent**: unclear how much production value beyond the pipeline; Slice 6 evaluates before rebuilding (may become a LangGraph graph or may be dropped — say which, with evidence).
- **Fidelity tolerance** (Slice 5a calibration): judge nondeterminism means "reproduce baseline" needs a stated tolerance; executor proposes it from repeat-run variance (alignment precedent: 8× stability sweeps).
- **Drizzle → Alembic ownership handoff** (Slice 9): until then Drizzle owns migrations and Python treats schema as given; if a mid-migration schema change is needed, it happens in Drizzle.
- **Live-LLM budget**: Slices 5b/6/7 need real inference for gates; API credits were empty 2026-07-16 — confirm funded before 5b starts.
