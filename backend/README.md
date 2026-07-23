# backend/ — the Quire Python backend

This is THE backend of the repo: all reasoning, storage, and serving converge
here. Migration from the TypeScript `journal/` is complete as of 2026-07-22
(see `../docs/decisions/2026-07-22-python-backend-migration-complete.md`).
What lives here:

- **Alignment** (`quire/analysis/`, the bulk of this README): given a pull
  request, determine which approved product obligations it may affect, what
  behavioral change the implementation introduces, whether that aligns with
  approved product intent, and which tests/evals/guards are missing. Not a
  code reviewer — a behavioral-alignment checker (the demo fixture happens
  to be an LLM refund agent, but any repo with approved intent docs works).
- **Journal Postgres read/write layer** (`quire/db/` + `quire/db/CENSUS.md`) —
  SQLAlchemy models for the live journal tables; `quire/db/writer.py` is the
  single writer for the ingestion tables (`sessions`, `raw_events`,
  `normalized_events`, `chunks`, `sittings`) as of Slice 4, and — as of Slice 5b —
  for the LLM-derived tables (`moments`, `moment_evidence`, `moment_relations`,
  `transitions`, `transition_moments`, `outcomes`, `outcome_moments`,
  `outcome_files`, `narratives`, `narrative_arcs`). Its `--force` purge-guard
  refuses to destroy LLM-derived rows without `allow_llm_purge=True` (CLI
  `--force` consents). `python3 -m quire.cli journal events` / `journal digest`.
- **Session ingestion** (`quire/ingest/`) — deterministic parse → normalize
  → chunk → sittings, parity-proven against the TS pipeline.
- **Understanding stage** (`quire/understand/`) — the LLM half of the
  digest: classify → topic-shifts → extract → weave → verify → derive-confidence
  → transitions → narrative. Every model step is a real structured-output
  LangChain call (Sonnet for extract/weave/verify/transitions/narrative, Haiku
  for classify/topic-shifts/exchange-classification); deterministic
  post-processing (anchor validation, dedup, weave-decision application, verdict
  application, confidence derivation) lives alongside. `FakeUnderstandLLM` +
  `quire/canned.py::fake_understand_llm()` drive offline tests. Fidelity-gated:
  `python3 -m evals.fidelity` scores stored digests ≥ the pinned TS baseline
  (`evals/baselines/2026-07-21-ts-fidelity.md`).

Digesting: `journal digest <log>` runs the full pipeline (deterministic +
LLM) and persists everything; `--dry-run` runs only the deterministic path
(no LLM, no writes) for parity; `--offline` uses canned LLM outputs (tests/CI).

**MCP Brain Server**:

Exposes 12 `brain_*` tools over stdio. Active entry in root `.mcp.json`:

```bash
python3 -m quire.cli mcp          # start MCP server (stdio) — for agents via .mcp.json
```

Tools: `brain_search`, `brain_file_context`, `brain_enter`, `brain_feature_context`,
`brain_moments`, `brain_evidence`, `brain_narrative`, `brain_report_observation`,
`brain_report_unknown`, `brain_rate_context`, `brain_propose_knowledge_delta`,
`brain_attention`.

All tool calls emit `mcp:{tool}` activity events (Python-owned single writer).
Golden tests: `tests/test_mcp_golden.py` (recorded against TS server, compare Python output).

**Dashboard / Journal API**:

35 REST routes serving the SPA (previously Express on port 3456, now FastAPI):

```bash
python3 -m quire.cli serve --port 3456   # start dashboard + journal API
# SPA: http://localhost:3456/
# API: http://localhost:3456/api/meta, /api/journal, /api/sessions, etc.
```

The built SPA lives in `quire/static/dashboard/` (output of `cd ../app && npm run build`).
Dev mode: `cd ../app && npm run dev` — proxies `/api` to localhost:3456.

Route census: 35 routes. POST /api/brain/digest is a deprecated SSE stub
(SPA degrades gracefully). GET /api/feed runs full feed composition (LLM-backed
with 1-hour cache, `quire/journal/feed.py`).

Data: `backend/.intent/raw-sessions/` holds raw CC logs (moved from `journal/.intent/`
as part of Slice 8; untracked).

**Watcher Daemon**:

```bash
python3 -m quire.cli journal watch-sessions              # watch ~/.claude/projects for new sessions (quiet >120 s)
python3 -m quire.cli journal watch-sessions --quiet-seconds 30  # faster threshold (testing/demo)
python3 -m quire.cli journal watch-sessions --projects-dir /path/to/dir  # override scan dir
```

The watcher polls every 30 s; digests any session file whose mtime has been
quiet for more than `--quiet-seconds`. Already-digested sessions skip silently
(idempotent via source_hash = log file stem). Emits activity events after each
successful digest. Failure-safe: a digest error for one file is logged and
skipped; the watcher continues.

The alignment subsystem persists to SQLite; migrating it to Postgres is a
follow-up (see decision record for details).

## Setup

Everything runs on the already-installed global packages (see
`requirements.txt` for pins: langchain 1.2.15, langgraph 1.1.6,
langsmith 0.7.9, pydantic 2.12.5, SQLAlchemy 2.0.47).

Credentials come from the repo-root `.env`: `ANTHROPIC_API_KEY` (live
inference), `LANGSMITH_API_KEY` / `LANGSMITH_TRACING` (tracing + evals),
`GITHUB_TOKEN` (live GitHub adapter, optional).

```bash
cd backend
docker compose up -d                   # start Postgres (Docker, port 5433)
python3 -m pytest                      # 551 tests, all offline (no API calls)
python3 -m evals.event_stream && python3 -m evals.alarms  # both must say "all clear"
python3 -m evals.fidelity             # fidelity eval (≥ TS baseline)
```

## Schema changes

The Postgres schema is frozen as inherited from the Drizzle migrations in the
TS backend (history at git tag `ts-backend-final`). No Drizzle is present in
the repo. Pre-Alembic bootstrap debt now spans 4 tables (session_checks, orgs, org_repos, org_channels) with an ALTER TABLE patch-forward firing on OrgStore init; Alembic adoption should retire all of it in one pass. Any future schema change starts by adopting Alembic: add it to
`requirements.txt`, run `alembic init`, and write a migration for the change.

## O5 — Telegram Alarm Delivery

When a promise breaks, the org's Telegram channel receives one message: a plain
sentence, the quote receipt, and a deep link to the exact annotated review. Silent on healthy work.

**2-minute setup:**

1. Message **@BotFather** on Telegram and run `/newbot`. Copy the bot token it gives you.
2. Add your bot to the chat or channel that should receive alarms.
3. Find your chat ID: add **@userinfobot** to the chat — it will reply with the numeric ID.
4. In the Quire dashboard, go to **Channels** → **Add Telegram channel**.
   Paste the token and chat ID. Click **Send a test message** to confirm delivery.

**Environment override:**

```
QUIRE_APP_HOST=https://your-quire.example.com  # default: http://localhost:3456
```

Deep links in alarm messages use this host. On localhost the default works;
in production set it to your public domain so the link lands on the real review.

**Without a token:** the system uses a StubChannel that records messages
(visible in logs at `DEBUG` level) and never fails. Add a real channel to
activate live delivery. The dedup mechanism prevents re-tapping the same break;
a new break (new PR) always fires even if the entity was already alarmed before.

**Delivery state** is stored in `org_channels.config._delivered_keys` (single-writer:
`OrgStore.update_channel_delivery_state`). The alarm policy's `seen=` parameter
suppresses dedup at compose time; delivery state is the persistent form across restarts.

## Follow-ups (named, not yet implemented)

- **Compose parallelization**: the three Sonnet calls in `quire/journal/feed.py`
  (`compose_lede`, `compose_story` × 2) run sequentially — ~10 s cold. Switch
  to `ThreadPoolExecutor(max_workers=3)` for ~3× speedup. Recorded at tag
  `ts-backend-final`.
- **Markdown-insensitive anchor matcher**: the fidelity anchor matcher is a
  single-stack concern now; the "both-stacks" note in the calibration doc is
  superseded. A proper markdown-insensitive matcher (strip formatting, normalize
  whitespace) reduces false-negative fidelity misses.
- **Mid-digest resume / parse-time stamping**: the watcher currently re-digests
  from scratch on resumption; parse-time stamping would allow incremental digests.
- **Latency**: end-to-end digest latency not yet benchmarked against TS baseline.
- **Alignment store → Postgres**: the alignment subsystem still writes SQLite;
  migration to the shared Postgres (single datastore) is the ruled next step.

## Demo

The refund-agent fixture: PRD v3 approves premium low-risk refunds up to
$100. PR #101 moves `RefundPolicy` to $100 but `RefundToolGuard` still
rejects everything above $50.

```bash
python3 -m quire.cli demo        # offline (canned LLM outputs)
python3 -m quire.cli demo --live # real Sonnet/Haiku inference
```

Expected: **PARTIAL**, missing premium/high-risk interaction test flagged,
human review required.

```bash
# any fixture PR (101..110 — one per eval scenario):
python3 -m quire.cli analyze refund-agent 106 --offline
python3 -m quire.cli list
python3 -m quire.cli show <analysis_id>
python3 -m quire.cli review <analysis_id> approved --reviewer you --note "guard PR follows"
```

## Dogfood: this repository (live)

`workspaces/intent-ai/` onboards this repo itself: obligations extracted
from `docs/prd.md` (the Brain serving loop), control points historically in
`src/mcp/feature.ts` / `server.ts` / `emit-events.ts` (TypeScript backend
deleted in Slice 9; see git history at tag `ts-backend-final`), and a **git adapter**
that treats any local base..head commit range as a PR (`prs.yaml`).

```bash
python3 -m quire.cli analyze intent-ai 1     # the 2026-07-07 "constraints
                                                   # always ride orientation" fix
```

Replay of five recent real commits (the "retroactive sweep"; live
inference, 2026-07-16):

| PR | Commit | Verdict |
|---|---|---|
| 1 | fix(mcp): constraints always ride orientation | ALIGNED, no review |
| 2 | feat(attention): brain_attention MCP tool | **POSSIBLE_DRIFT** — new agent-facing tool, no approved intent; hard-rule surface impacted; review |
| 3 | docs-only audit note | NO_MATERIAL_IMPACT, no review |
| 4 | fix(feed): dashboard fixes | POSSIBLE_DRIFT — surface not covered by the obligation contract |
| 5 | fix(attention): drizzle migration | POSSIBLE_DRIFT — same coverage gap |

PR 2 is a true catch (shipped behavior nobody approved as product intent);
PRs 4–5 are *coverage* findings — the contract only covers the MCP serving
loop, so feed/infra changes are ungoverned by construction. Both readings
are useful: drift verdicts either flag unauthorized behavior or tell you
which intent (specs in `docs/superpowers/specs/`, plans) should be
registered as approved sources next. To audit another commit: add a
base/head entry to `workspaces/intent-ai/prs.yaml` and analyze it.
**Invariant: `prs.yaml` entries must use full SHA literals for `base` and `head`, never branch names -- a branch ref re-resolved at render time can diverge from the analyzed commit, producing a misleading diff.**

## Onboarding wizard (proactive)

```bash
python3 -m quire.cli serve --port 8321
# open http://127.0.0.1:8321/onboard
```

Four acts, the system leads at every step: **Scan** (point at a repo — it
finds candidate intent sources itself, ranked by how many product promises
they contain, and lines up recent commits), **Draft** (mines the chosen
sources into obligation cards with verbatim provenance, live inference),
**Approve** (the only human step — edit/reject cards, toggle bindings; the
session is the approval act), **First results** (writes the approved
workspace and replays the last commits against the new contract, verdicts
appearing per commit, ending at that workspace's intent ledger).

## Intent ledger (time-travel demo surface)

```bash
python3 -m quire.cli serve --port 8321
# open http://127.0.0.1:8321/intent/intent-ai   (or /intent/refund-agent)
```

Every check (PR analysis) is an event on a scrubbable timeline: pick any
event to see the intent state *as of that moment* (per-obligation status
lamps, since-which-check, confidence), the exact effect of that
check (state transitions with reasoning), contract-revision markers
(⟡ when the obligation set changed), and the open intent-inbox at that
point. The page polls; to demo live: merge/commit → add a base/head entry
to the workspace `prs.yaml` → `analyze <workspace> <n>` → the event appears
and the state advances. Analyzer version bumps create new events instead of
rewriting history (identity includes analyzer version).

## Server

```bash
python3 -m quire.cli serve --port 8321
# POST /analyses {"workspace": "refund-agent", "pr_number": 101, "offline": true}
# GET  /analyses/{id}   GET /analyses/{id}/comment   POST /analyses/{id}/review
```

## Evals (LangSmith)

```bash
python3 evals/dataset.py               # create/update dataset `alignment-mvp-e2e` (10 cases)
python3 evals/run_eval.py              # offline harness check (canned LLM)
python3 evals/run_eval.py --live       # real-inference baseline (EDD)
python3 evals/run_eval.py --variant exhaustive-v1   # A/B a config/topology variant
```

Ten scenarios: aligned / partial (demo) / hard-rule violation / undeclared
drift / refactor / removed enforcement / config-only drift / missing
coverage / stale-PRD distractor / ambiguous sources → UNKNOWN. Deterministic
evaluators score every stage (artifact selected, stale rejected, obligations
identified, control points matched, evidence pointers valid, classification,
abstention, review flag); an optional LLM judge (`--judge`) grades only
explanation quality. The same cases run in `tests/test_eval_cases.py` as the
offline regression harness — a reviewed production mistake becomes a new
fixture PR dir + one entry in `evals/cases.py`.

## How it works

```
load PR → snapshot artifacts → resolve product context (5-rung ladder: a
fixed priority order of intent sources, most authoritative first)
→ load obligations (contract snapshot + idempotency cache check)
→ parse declared intent (Haiku) → collect diff → match control points (deterministic)
→ gather bounded code context → infer behavioral delta (Sonnet, structured)
→ compare with obligations (Sonnet, structured, per obligation)
→ inspect tests/evals/guards (deterministic) → validate evidence (deterministic)
→ classify (deterministic rules) → persist (SQLite) → publish (comment markdown)
```

Key invariants:

- **The LLM never decides the final label.** It produces validated Pydantic
  structures (`DeclaredIntent`, `BehavioralDelta`, `ObligationImpact`);
  ordered deterministic rules in `analysis/classify.py` pick the
  classification. UNKNOWN is preferred over unsupported certainty.
- **Similarity never grants authority.** The context ladder (explicit links →
  manifest → bindings → lexical retrieval → abstain) checks provider-asserted
  authority (`approved`/`draft`/`stale`) at every rung; conflicting approved
  links abstain rather than pick a side.
- **Code never creates intent.** Obligations only come from approved
  artifacts; a behavior change with no matching obligation is POSSIBLE_DRIFT.
- **Every citation is checked.** Evidence excerpts must resolve verbatim
  against the diff, file contents, or artifact snapshots.
- **Idempotent identity**: `sha256(repo, pr#, head_sha, contract_snapshot,
  analyzer_version)` — cached results short-circuit the whole graph.
- **Experimentable by construction**: topology variants are registered by
  name in `analysis/graph.py`; every threshold/scope/model choice lives in
  `analysis/config.py` (`AnalyzerConfig`), so variants A/B through
  `run_eval.py --variant`.

Layout: `quire/models.py` (domain), `quire/adapters/` (fixture +
live GitHub; analysis logic is provider-blind), `quire/analysis/`
(graph, nodes, deterministic core, LLM layer), `quire/store.py`
(SQLite), `fixtures/refund-agent/` (workspace: manifest, PRD current/stale/
draft, obligations, bindings, base tree, PRs 101–110).

## Key decisions

- **SQLite, not the repo Postgres** (2026-07-16) — the schema was
  Drizzle/TS-owned and no Python ORM existed. **Superseded 2026-07-21:**
  a Python ORM now exists (`quire/db/`, SQLAlchemy) and the founder ruled
  Postgres-for-everything; this store migrates per the migration plan.
- **Rule-based classification over structured LLM output** — keeps evals
  deterministic and the label auditable; the model contributes evidence, not
  verdicts.
- **Canned LLM outputs (`quire/canned.py`) as a first-class artifact** —
  tests, offline demo, and offline eval runs all exercise the full pipeline
  without network; live runs swap in `AnthropicAlignmentLLM` only.
- **Product truth stays local even with the GitHub adapter** — GitHub supplies
  PR/code material; approved requirements/obligations/bindings come from the
  workspace, because GitHub is not an authority on product intent.

## Live-inference results (EDD loop, 2026-07-16)

Five live runs, fixing between each (`evals/summarize.py <experiment>` for
any run): 69/90 → 76/90 → 83/90 → 89/90 → **90/90** evaluator checks
(final: 10/10 classifications, review flags, evidence validity, abstention).
What each iteration fixed, in order: relation semantics
(preserved-but-untouched ≠ satisfies), head-state facts polluting `changes`
(→ `gaps`), invalid citations shipping (→ validated & dropped),
verification state demoting behavior relations, obligations flagged without
any changed bound control point (→ deterministic binding gate, also fewer
LLM calls), and a too-narrow source excerpt letting the model guess
approved values from old code (→ serve the full approved artifact).
Method: blind probes (fresh sub-agents given the production prompts with no
eval framing) diagnosed failures before any API spend, and an unseen case
verified fixes generalize.

## Known limitations

- Stability (2026-07-17): after the variance fix, **8 consecutive live runs
  scored 99/99** (11 cases × 9 evaluators, zero failures of any evaluator
  on any case). Re-run the sweep after any prompt or contract change:
  `for i in $(seq 8); do python3 -u evals/run_eval.py --live; done`.
- **Registry-first semantics** (`strict_binding_gate` — the "binding gate":
  an obligation whose registered code locations are all untouched by the PR
  is marked unrelated deterministically, with no LLM call). A violation
  smuggled through an unregistered file surfaces as POSSIBLE_DRIFT (review
  required), not OFF_INTENT — bindings are the registry, drift is the
  catch-all. `exhaustive-v1` disables the gate.
- Retrieval rung is lexical overlap, not embeddings — fine at fixture scale,
  a stand-in beyond it.
- Enforcement-removal detection is structural (deleted file/symbol/call
  site); a semantically neutered guard body would need the LLM path.
- Bindings are hand-curated in `bindings.yaml`; no assisted onboarding yet.
- One repository per workflow.
- Obligation comparison is one LLM call per candidate obligation (fine at
  5–15; would want batching beyond).

## Next highest-value increment

The live analyzer now matches expectations on all 10 cases, and
`--publish` posts `comment_markdown` to real PRs for `github`-provider
workspaces. Next: wire a real repo's manifest + obligations to dogfood on
this very repository — real PRs will grow the regression set (new fixture
dir + `evals/cases.py` entry per reviewed mistake) far better than more
synthetic cases would.
