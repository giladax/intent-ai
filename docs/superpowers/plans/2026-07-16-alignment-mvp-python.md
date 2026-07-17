# Product-to-Code Alignment MVP (Python) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Given a PR, determine which approved product obligations it affects, what behavioral change it introduces, whether that aligns with approved intent, and what evidence is missing — as a runnable Python MVP under `alignment/`.

**Architecture:** A typed LangGraph pipeline (deterministic nodes + three Pydantic structured-output LLM nodes) over provider adapters (fixture + live GitHub), persisting idempotent `PRAnalysis` rows in SQLite via SQLAlchemy. Classification is **rule-based** over structured LLM outputs — the LLM never picks the final label. LangSmith dataset of 10 end-to-end cases with deterministic evaluators.

**Tech Stack (installed versions, do not upgrade):** Python 3.11.4, langchain 1.2.15, langchain-anthropic 1.3.4, langgraph 1.1.6, langsmith 0.7.9, pydantic 2.12.5, SQLAlchemy 2.0.47, typer 0.24.1, FastAPI 0.134.0, PyYAML 6.0.3, pytest 9.0.2.

## Global Constraints

- No TypeScript, no graph DB, no new infrastructure. Pure-Python subproject at `alignment/`.
- SQLite persistence (repo's Postgres is TS/Drizzle-only; spec allows SQLite if no Python ORM exists).
- Models: `claude-sonnet-4-6` for delta inference + obligation comparison; `claude-haiku-4-5` for declared-intent parsing (matches repo convention: Sonnet reasoning, Haiku classification).
- Code never creates/modifies approved intent. Change without matching obligation ⇒ POSSIBLE_DRIFT.
- Prefer UNKNOWN over unsupported certainty. Semantic similarity alone never establishes authority.
- Every analysis references exact snapshots: content hashes, base/head SHAs, contract snapshot id.
- Idempotency key: sha256(repo, pr_number, head_sha, contract_snapshot_id, analyzer_version).
- Analyze only: PR diff, changed/bound control points, nearby code, linked requirements/issues, relevant tests/evals/config. No repo-wide indexing.
- Tests must pass offline — LLM calls behind an injectable `AlignmentLLM` protocol with a canned `FakeAlignmentLLM`.

## File Structure

```
alignment/
  README.md                       setup / test / demo / server commands
  requirements.txt                pins == installed versions
  quire_align/
    __init__.py                   ANALYZER_VERSION = "0.1.0"
    models.py                     all domain + structured-output Pydantic models, enums
    manifest.py                   WorkflowManifest YAML loader
    store.py                      SQLAlchemy SQLite persistence + idempotency
    adapters/base.py              WorkspaceAdapter protocol (requirements/repo/work-tracking)
    adapters/fixture.py           fixture workspace reader (dir layout below)
    adapters/github.py            live GitHub PR adapter (GITHUB_TOKEN, requests)
    analysis/state.py             AnalysisState (Pydantic) for StateGraph
    analysis/matching.py          deterministic control-point matching from diff
    analysis/context.py           product-context resolution ladder (5 steps, abstain)
    analysis/evidence.py          deterministic evidence-citation validation
    analysis/classify.py          rule-based classification + human-review triggers
    analysis/llm.py               AlignmentLLM protocol, AnthropicAlignmentLLM, FakeAlignmentLLM
    analysis/nodes.py             LangGraph node functions
    analysis/graph.py             build_analysis_graph(deps) -> compiled StateGraph
    analysis/render.py            GitHub-comment markdown renderer
    cli.py                        typer: analyze / show / review / demo / serve
    api.py                        FastAPI: POST /analyses, GET /analyses/{id}, POST /analyses/{id}/review
  fixtures/refund-agent/
    workflow.yaml                 manifest (spec format)
    requirements/refund-policy-prd.md          approved v3
    requirements/refund-policy-prd-v2-draft.md stale/draft distractor
    obligations.yaml              5+ approved obligations w/ source refs + revisions
    bindings.yaml                 control points + obligation bindings
    issues/REF-42.yaml            linked work item
    repo/base/**                  refund agent source at base SHA (policy, guard, executor, config, audit, tests)
    repo/prs/<n>/pr.yaml          PR metadata (title, body, base/head sha, linked issue)
    repo/prs/<n>/head/**          changed files at head (diff computed vs base via difflib)
  evals/
    cases.py                      10 case definitions + expectations (table below)
    dataset.py                    create/update LangSmith dataset
    evaluators.py                 deterministic evaluators + optional LLM explanation judge
    run_eval.py                   langsmith evaluate() runner
  tests/                          unit + e2e (FakeAlignmentLLM), CLI, API, idempotency
```

## Key Interfaces

```python
class AlignmentLLM(Protocol):
    def parse_intent(self, pr_title, pr_body, issue) -> DeclaredIntent: ...
    def infer_delta(self, diff, code_context, declared) -> BehavioralDelta: ...
    def assess_obligation(self, obligation, delta, diff, code_context, coverage) -> ObligationImpact: ...

def build_analysis_graph(*, adapter, llm, store) -> CompiledStateGraph  # invoke({"workflow_dir"/"pr_number"...})
def run_analysis(workspace, pr_number, *, llm=None, store=None, force=False) -> PRAnalysis
```

`ObligationImpact.relation ∈ {satisfies, partially_satisfies, contradicts, unrelated}`, plus `missing_evidence: list[str]`, `confidence`, evidence citations (path/lines/hunk).

## Classification rules (deterministic, ordered)

1. Context resolution abstained OR authority ambiguous/conflicting ⇒ UNKNOWN.
2. Empty behavioral delta AND no bound control points touched ⇒ NO_MATERIAL_IMPACT.
3. Any impact `contradicts` a hard-rule obligation OR an enforcement-role control point removed ⇒ OFF_INTENT.
4. Any behavior change with no obligation relation (all `unrelated`) ⇒ POSSIBLE_DRIFT.
5. Any `partially_satisfies`, OR satisfied obligation whose other bound control point is stale/conflicting ⇒ PARTIAL.
6. All impacts `satisfies` AND evidence validated ⇒ ALIGNED.
7. Evidence validation failed / low confidence ⇒ UNKNOWN.

Human review required when: hard-rule obligation impacted; enforcement point removed; undeclared behavior change (delta ⊄ declared intent); ambiguous requirement authority; conflicting evidence; missing direct evidence; classification ∈ {PARTIAL, POSSIBLE_DRIFT, OFF_INTENT, UNKNOWN}.

## Context-resolution ladder (analysis/context.py)

1. PR→issue→requirement explicit links (pr.yaml `issue:` → issue `requirement:`).
2. Manifest-registered sources.
3. Existing bindings (obligations bound to control points matching changed paths).
4. Lexical/semantic retrieval **within manifest scope only** — marks candidates, never grants authority.
5. Abstain ⇒ `context.abstained = True` with reason (drives UNKNOWN).

## Eval case matrix (evals/cases.py — LangSmith dataset `alignment-mvp-e2e`)

| # | Case | PR fixture | Expected class | Review |
|---|------|-----------|----------------|--------|
| 1 | Fully aligned change | policy+guard+test all → $100 | ALIGNED | no |
| 2 | Partial implementation (demo) | policy → $100, guard still $50 | PARTIAL | yes |
| 3 | Off-intent hard-rule violation | auto-approve high-risk refunds | OFF_INTENT | yes |
| 4 | Change without approved intent | adds loyalty-points multiplier | POSSIBLE_DRIFT | yes |
| 5 | Irrelevant refactor | rename internals, no behavior | NO_MATERIAL_IMPACT | no |
| 6 | Removed enforcement point | delete RefundToolGuard check | OFF_INTENT | yes |
| 7 | Config-only behavior change | prompt/policy yaml limit → 200 | POSSIBLE_DRIFT | yes |
| 8 | Missing test/eval coverage | policy+guard → $100, no tests | PARTIAL | yes |
| 9 | Stale PRD distractor | like #1 but draft PRD says $500 | ALIGNED (draft rejected) | no |
| 10 | Ambiguous product source | two conflicting approved sources | UNKNOWN | yes |

Per-case expectations: retrieved sources, affected obligations, control points, evidence validity, classification, review flag. Deterministic evaluators for each intermediate stage; LLM judge only for explanation quality (non-primary).

## Tasks

- [ ] **T1 scaffold + models**: `models.py` with all enums/objects, hashing helpers; tests for hashing, contract-snapshot id stability, analysis idempotency key.
- [ ] **T2 fixtures (refund-agent base)**: manifest, PRD (approved+draft), obligations, bindings, issue, base repo tree, PR #101 (demo PARTIAL) + #102 (aligned).
- [ ] **T3 manifest + fixture adapter**: YAML loader; workspace reader producing ArtifactSnapshots, PR metadata, unified diff via difflib; tests.
- [ ] **T4 deterministic core**: matching.py, context.py, classify.py, evidence.py, render.py — TDD each.
- [ ] **T5 llm.py**: structured-output models wired to ChatAnthropic `.with_structured_output`; FakeAlignmentLLM with per-case canned outputs.
- [ ] **T6 graph**: state.py, nodes.py, graph.py per node list in spec; conditional edges (abstain→classify, empty diff→classify); e2e test with fake LLM reproduces demo PARTIAL.
- [ ] **T7 store**: SQLAlchemy tables, idempotent persist (unique analysis key), review-state updates; tests.
- [ ] **T8 CLI + API**: typer commands + FastAPI; tests via TestClient/CliRunner.
- [ ] **T9 GitHub live adapter**: PR metadata/files/diff via REST when GITHUB_TOKEN set; unit test with mocked transport.
- [ ] **T10 remaining 8 PR fixtures + eval harness**: cases.py, dataset.py, evaluators.py, run_eval.py (invoke langsmith-dataset + langsmith-evaluator skills first).
- [ ] **T11 demo + README + full verification**: `cli demo` (real LLM if key present), README with setup/test/demo/server, `pytest` green, live demo run captured.

## Non-goals (verbatim from spec)

No repo-wide understanding/indexing, org search, intent generation from code, full eval platform, session ingestion, code-review replacement, graph DB, polished frontend, deploy blocking.
