# 10 — The Analysis Pipeline (checks)

The PR/commit alignment engine: given a change and an approved contract,
produce a verdict with per-promise findings, each citation validated.
Topology in `analysis/graph.py`; node bodies in `analysis/nodes.py`;
verdict logic in `analysis/classify.py`. See
[00 overview](00-architecture-overview.md), [20 LLM sites](20-llm-call-sites.md).

## Topology: `linear-v1` (`analysis/graph.py:_linear_v1`)

A LangGraph `StateGraph` over `AnalysisState` (`analysis/state.py`).
Registered by name so variants A/B through the eval harness without
touching node logic (`register_topology`).

```
START
 → load_inputs            PR, issue, obligations, bindings, control points
 → snapshot_artifacts     content-hash the intent docs (provenance pins)
 → resolve_product_context   which approved sources are authoritative (or abstain)
 → load_obligations       build ContractSnapshot; CHECK IDEMPOTENCY CACHE ─┐
 → (conditional after_obligations)                                          │
      cached?  ───────────────────────────────────────────► publish  ◄──────┘  short-circuit A
      abstained & short_circuit_on_abstain? ──────────────► classify_alignment  short-circuit B
      else ────────────────────────────────────────────► parse_intent
 → parse_intent           declared intent (LLM, Haiku)
 → collect_diff
 → (conditional after_diff)
      empty diff? ────────────────────────────────────► classify_alignment       short-circuit C
      else ──────────────────────────────────────────► match_points
 → match_points           bind changed files → control points → candidate obligations
 → gather_code_context    fetch head content of changed + bound files (capped)
 → infer_delta            behavioral delta (LLM, Sonnet)
 → (conditional after_delta)
      immaterial delta & enforcement intact? ─────────► classify_alignment       short-circuit D
      else ──────────────────────────────────────────► compare_obligations
 → compare_obligations    per candidate obligation: impact verdict (LLM, Sonnet ×N)
 → inspect_tests          coverage: did bound tests/evals move with the change?
 → validate               DROP citations that don't resolve verbatim
 → classify_alignment     deterministic ordered rules → Classification
 → persist                PRAnalysis + snapshots + contract to store (idempotent id)
 → publish                comment markdown (+ optional PR comment)
END
```

## Stages (input · output · det/LLM · failure · invariant)

| stage | in | out | det/LLM | on failure | invariant upheld |
|---|---|---|---|---|---|
| `load_inputs` | PR # | pr, issue, contract parts | det (adapter) | adapter error → 502 upstream | reads only; never writes contract |
| `snapshot_artifacts` | intent docs | content-hashed `ArtifactSnapshot`s | det (`store.save_snapshots`) | — | provenance: every quote pins to a doc revision |
| `resolve_product_context` | sources, refs | `ContextResolution` or **abstain** | det ladder (`analysis/context.py`) | conflicting authorities → `abstained=True` | authority ladder; abstain beats guessing |
| `load_obligations` | obligations | `ContractSnapshot` + cache probe | det | — | **idempotency** (below) |
| `parse_intent` | pr, issue | `DeclaredIntent` | **LLM Haiku** | Fake offline; low stakes | intent is READ from the PR, not invented as contract |
| `collect_diff` | pr | unified diff | det (adapter) | — | — |
| `match_points` | changed files, CPs | matched CPs, removed enforcement, candidate obligations | det (`matching.py`) | — | **binding gate**: only bound/resolved obligations are candidates |
| `gather_code_context` | candidates, CPs | head file contents (≤ `max_context_files`) | det | missing file → skipped | bounded context; no repo-wide indexing |
| `infer_delta` | diff, declared, code | `BehavioralDelta` (material?, changes[]) | **LLM Sonnet** | Fake offline | — |
| `compare_obligations` | delta, diff, code, per obligation | `ObligationImpact[]` (relation, confidence, evidence[], missing_evidence[]) | **LLM Sonnet ×N** | Fake offline | one call per candidate; UNRELATED for untouched |
| `inspect_tests` | delta, coverage sources | `CoverageFinding[]` (`verified_by_changed_tests`, gaps) | det (`coverage.py`, glob) | — | deterministic coverage overrides LLM gap ideas |
| `validate` | impacts | `evidence_valid`, `dropped_citations` | det (`evidence.py`) | invalid citation **dropped** | **no quote, no render** |
| `classify_alignment` | everything above | `Classification`, review reasons, missing evidence | **det** (`classify.py`) | — | verdict is deterministic over structured findings |
| `persist` | analysis | `PRAnalysis` in store | det | — | idempotent id; append-only checks |
| `publish` | analysis | comment markdown | det (`render.py`) | no publisher → local only | loud verdicts only unless `--publish-all` |

## The binding gate (why it can't over-flag)

`match_points` (`analysis/nodes.py:match_points`): unless
`obligation_scope == "all"`, candidate obligations are exactly those
**bound to a matched control point** OR whose `source_reference` is in the
resolved context. An obligation with no touched binding is never assessed
— it deterministically stays UNRELATED, saving both the LLM call and the
false positive. (Scale run: 201/211 impact verdicts resolved free by this
gate.)

## Evidence validation (why it can't fabricate)

`analysis/evidence.py:validate_evidence` → `validate_evidence_item`:
every citation's `excerpt` must appear **verbatim** (whitespace-normalized,
`_normalize`) in the diff, a snapshot artifact, or head file content.
Citations that don't resolve are removed and counted in
`dropped_citations` — an audit trail of how much the model fabricated. A
relation-asserting finding that loses all citations makes
`evidence_valid=False`, which blocks ALIGNED (see rules).

## Classification (`classify.py:classify`, ordered — first match wins)

```
abstained                                   → UNKNOWN
not material & no removed enforcement        → NO_MATERIAL_IMPACT
removed enforcement OR any contradiction     → OFF_INTENT
(no related OR uncovered change) &
    governed territory touched               → POSSIBLE_DRIFT
    else                                     → UNGOVERNED   (onboarding prompt, not alarm)
partials OR coverage gaps                    → PARTIAL
satisfies & evidence_valid & all conf ≥ low  → ALIGNED
else                                         → UNKNOWN      (prefer UNKNOWN to false blessing)
```

**Why it can't falsely bless:** ALIGNED requires (1) real SATISFIES
impacts, (2) `evidence_valid` (every relation-asserting finding kept a
resolving citation), AND (3) every satisfies-confidence ≥ `low_confidence`
threshold. Any gap, any contradiction, any removed enforcement, any
abstention routes away from ALIGNED. The terminal `else` is UNKNOWN, not
ALIGNED — the system defaults to "needs review", never to "fine".

**Human-review triggers** (`classify.py`, appended to any verdict):
hard-rule impacted, enforcement removed, undeclared behavior, ambiguous
requirements → `PRAnalysis.human_review_required`, `review_state=PENDING`.

## Authority ladder & abstention (`analysis/context.py`)

Which document is authoritative when several claim to be: explicit links →
manifest declaration → bindings → lexical → **abstain**. Abstention
(`ContextResolution.abstained`) forces UNKNOWN and a review reason —
the system refuses to pick a source rather than guess (PM-interrogation
lesson; PRD rule 3 applied to sources).

## Idempotency & provenance

`analysis_key(repository, pr_number, head_sha, contract_snapshot_id,
ANALYZER_VERSION)` (`analysis/nodes.py:load_obligations`,`persist`). The
same code, same contract, same commit → cache hit → `publish`
short-circuit, **zero LLM**. A contract edit or analyzer bump changes the
key → a fresh check. `ContractSnapshot.contract_snapshot_id` is the sorted
hash of obligation pins (`models.py`); `ArtifactSnapshot` content-hashes
each intent doc so a quote always pins to the revision it came from.
Checks are append-only (`store.save_analysis`); the timeline
(`timeline.build_timeline`) folds them into per-promise standing.
