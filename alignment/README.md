# Quire Align — product-to-code alignment for production agents (Python MVP)

Given a pull request, determine: which approved product obligations it may
affect, what behavioral change the implementation introduces, whether that
change aligns with approved product intent, and which tests/evals/guards are
missing. Not a code reviewer — a behavioral-alignment checker.

This is the Python prototype of the repo's Phase-2 "alignment" thesis
(see `docs/prd.md`), self-contained under `alignment/`.

## Setup

Everything runs on the already-installed global packages (see
`requirements.txt` for pins: langchain 1.2.15, langgraph 1.1.6,
langsmith 0.7.9, pydantic 2.12.5, SQLAlchemy 2.0.47).

Credentials come from the repo-root `.env`: `ANTHROPIC_API_KEY` (live
inference), `LANGSMITH_API_KEY` / `LANGSMITH_TRACING` (tracing + evals),
`GITHUB_TOKEN` (live GitHub adapter, optional).

```bash
cd alignment
python3 -m pytest                      # 58 tests, all offline (no API calls)
```

## Demo

The refund-agent fixture: PRD v3 approves premium low-risk refunds up to
$100. PR #101 moves `RefundPolicy` to $100 but `RefundToolGuard` still
rejects everything above $50.

```bash
python3 -m quire_align.cli demo        # offline (canned LLM outputs)
python3 -m quire_align.cli demo --live # real Sonnet/Haiku inference
```

Expected: **PARTIAL**, missing premium/high-risk interaction test flagged,
human review required.

```bash
# any fixture PR (101..110 — one per eval scenario):
python3 -m quire_align.cli analyze refund-agent 106 --offline
python3 -m quire_align.cli list
python3 -m quire_align.cli show <analysis_id>
python3 -m quire_align.cli review <analysis_id> approved --reviewer you --note "guard PR follows"
```

## Dogfood: this repository (live)

`workspaces/intent-ai/` onboards this repo itself: obligations extracted
from `docs/prd.md` (the Brain serving loop), control points in
`src/mcp/feature.ts` / `server.ts` / `emit-events.ts`, and a **git adapter**
that treats any local base..head commit range as a PR (`prs.yaml`).

```bash
python3 -m quire_align.cli analyze intent-ai 1     # the 2026-07-07 "constraints
                                                   # always ride orientation" fix
```

Retroactive sweep of five real commits (live inference, 2026-07-16):

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

## Onboarding wizard (proactive)

```bash
python3 -m quire_align.cli serve --port 8321
# open http://127.0.0.1:8321/onboard
```

Four acts, the system leads at every step: **Scan** (point at a repo — it
finds candidate intent sources itself, ranked by promise density, and lines
up recent commits), **Draft** (mines the chosen sources into obligation
cards with verbatim provenance, live inference), **Approve** (the only
human step — edit/reject cards, toggle bindings; the session is the
approval act), **First light** (writes the approved workspace and replays
the last commits against the new contract, verdicts appearing per commit,
ending at that workspace's intent ledger).

## Intent ledger (time-travel demo surface)

```bash
python3 -m quire_align.cli serve --port 8321
# open http://127.0.0.1:8321/intent/intent-ai   (or /intent/refund-agent)
```

Every digestion (PR analysis) is an event on a scrubbable timeline: pick any
event to see the intent state *as of that moment* (per-obligation status
lamps, since-which-digestion, confidence), the exact effect of that
digestion (state transitions with reasoning), contract-revision markers
(⟡ when the obligation set changed), and the open intent-inbox at that
point. The page polls; to demo live: merge/commit → add a base/head entry
to the workspace `prs.yaml` → `analyze <workspace> <n>` → the event appears
and the state advances. Analyzer version bumps create new events instead of
rewriting history (identity includes analyzer version).

## Server

```bash
python3 -m quire_align.cli serve --port 8321
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
load PR → snapshot artifacts → resolve product context (5-rung ladder)
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

Layout: `quire_align/models.py` (domain), `quire_align/adapters/` (fixture +
live GitHub; analysis logic is provider-blind), `quire_align/analysis/`
(graph, nodes, deterministic core, LLM layer), `quire_align/store.py`
(SQLite), `fixtures/refund-agent/` (workspace: manifest, PRD current/stale/
draft, obligations, bindings, base tree, PRs 101–110).

## Key decisions

- **SQLite, not the repo Postgres** — the existing schema is Drizzle/TS-owned;
  spec allows SQLite when no Python ORM exists.
- **Rule-based classification over structured LLM output** — keeps evals
  deterministic and the label auditable; the model contributes evidence, not
  verdicts.
- **Canned LLM outputs (`quire_align/canned.py`) as a first-class artifact** —
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
- **Registry-first semantics** (`strict_binding_gate`): obligations whose
  registered control points are untouched are deterministically unrelated.
  A violation smuggled through an unregistered file surfaces as
  POSSIBLE_DRIFT (review required), not OFF_INTENT — bindings are the
  registry, drift is the catch-all. `exhaustive-v1` disables the gate.
- Retrieval rung is lexical overlap, not embeddings — fine at fixture scale,
  a stand-in beyond it.
- Enforcement-removal detection is structural (deleted file/symbol/call
  site); a semantically neutered guard body would need the LLM path.
- Bindings are hand-curated in `bindings.yaml`; no assisted onboarding yet.
- One repository per workflow; GitHub adapter has no pagination beyond 100
  changed files; comment publishing to GitHub is rendered but not posted.
- Obligation comparison is one LLM call per candidate obligation (fine at
  5–15; would want batching beyond).

## Next highest-value increment

The live analyzer now matches expectations on all 10 cases. Next: post
`comment_markdown` to real PRs behind `--publish`, and wire a real repo's
manifest + obligations to dogfood on this very repository — real PRs will
grow the regression set (new fixture dir + `evals/cases.py` entry per
reviewed mistake) far better than more synthetic cases would.
