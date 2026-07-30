# Spec ↔ Code Reconciliation — Round 1 (2026-07-20)

Scope: the five layered specs in `docs/specs/` (commit `664fc08`) verified
claim-by-claim against `quire/`, plus a dead-code hunt the specs
expose. Goal: a diligence engineer can grep any spec claim and it holds;
no dead code undermines the story.

Baseline: `python3 -m pytest` = **201 passed**. After all edits: **201
passed** (green preserved).

---

## (A) Claims verified TRUE

The specs are, overwhelmingly, already one thing with the code. Every
citation below was walked to source and confirmed.

### Spec 20 — the LLM inventory (the line-by-line file)

**Count is correct: 17 distinct call sites.** No miscount, no double-count,
no missed call. Each verified for existence, model, schema, and det-gate:

| # | site | model | schema | det-gate verified |
|---|---|---|---|---|
| 1 | `analysis/llm.py:parse_intent` | Haiku (`CLASSIFIER_MODEL`) | `DeclaredIntent` | advisory only ✓ |
| 2 | `analysis/llm.py:infer_delta` | Sonnet (`REASONING_MODEL`) | `BehavioralDelta` | `material` gate + short-circuit D ✓ (`graph.py:after_delta`) |
| 3 | `analysis/llm.py:assess_obligation` ×N | Sonnet | `ObligationImpact` | binding gate + evidence validation + `classify.py` decides ✓ |
| 4 | `propose.py:extract_obligations` | Sonnet | `ObligationCandidates` | `validate_candidates` verbatim quote ✓ |
| 5 | `propose.py:propose_bindings` | Sonnet | `BindingCandidates` | path must be in repo tree ✓ |
| 6 | `entity_propose.py:EntityProposerLLM.propose` | Sonnet | `EntityCandidates` | `_validated` verbatim + `_wrong_scale` (`_CORPUS_NAME_SHARE=0.6`) + dup-name drop ✓ |
| 7 | `entity_propose.py:haiku_doc_complement_judge` | Haiku | `Verdict{contradicts_identity}` | screens attachments; phrased independently of #16 ✓ |
| 8 | `graph_heuristics.py:name_areas` | Haiku | `AreaNames` | precedence human > LLM > TF-IDF ✓ |
| 9 | `graph_heuristics.py:judge_pair` | Haiku | `PairVerdict` | borderline cosine window `(0.15,0.45)`, budget cap `MAX_PAIR_JUDGEMENTS_PER_RUN=10` ✓ |
| 10 | `graph_heuristics.py:route_question` | Haiku | `RouteDecision` (Literal 5-enum) | closed enum; regex is logged offline fallback ✓ |
| 11 | `mind.py:_thinker` (phase 1) | Sonnet, T0.6 | plain text | none — thinking runs free ✓ |
| 12 | `mind.py:_structurer` (phase 2) | Sonnet, T0 | `Mind` | `validate_mind` drops unresolvable connections ✓ |
| 13 | `story.py:StorytellerLLM.tell` | Sonnet | `Story{sentences[]{text,cites[]}}` | `validate_story` cite-resolution + causal-cite rule ✓ |
| 14 | `story.py:faithfulness_judge` | **Sonnet** | `Verdict{faithful}` | Sonnet-on-purpose comment present ✓ |
| 15 | `ask.py:haiku_pick` | Haiku | `TermPick` | last-rung only after alias/label/lexical rungs ✓ |
| 16 | `evals/seed_quality.py:_haiku_complement_judge` | Haiku | `Verdict{complement}` | eval-only; phrased independently of #7 ✓ |
| 17 | `evals/repo_cognition.py:judge_case` | Sonnet | `Verdict{found}` | eval-only ✓ |

The model-choice policy row-by-row matches: judges guarding user-facing
truth (#14 faithfulness) run on Sonnet; cheap recoverable routing (#8–10,
#15) on Haiku. All five `with_structured_output` schemas in each row match
the actual Pydantic classes.

### Spec 10 — the analysis pipeline

- Topology `linear-v1` in `analysis/graph.py:_linear_v1`, registered by
  name (`register_topology`) — verified.
- Every node and edge in the ASCII topology matches the actual
  `add_node`/`add_edge`/`add_conditional_edges` calls, in order:
  load_inputs → snapshot_artifacts → resolve_product_context →
  load_obligations → parse_intent → collect_diff → match_points →
  gather_code_context → infer_delta → compare_obligations → inspect_tests
  → validate → classify_alignment → persist → publish.
- All **four short-circuits** verified against the conditional-edge bodies:
  A cached→publish (`after_obligations`), B abstain→classify
  (`after_obligations`), C empty-diff→classify (`after_diff`), D immaterial
  delta + intact enforcement→classify (`after_delta`).
- Classification rules (spec §Classification, ordered first-match-wins)
  verified line-for-line against `classify.py:classify` (lines 117–146):
  abstained→UNKNOWN, not-material→NO_MATERIAL_IMPACT, removed-enforcement
  OR contradiction→OFF_INTENT, (no related OR uncovered) with
  governed-touched→POSSIBLE_DRIFT else UNGOVERNED, partials/gaps→PARTIAL,
  satisfies+evidence_valid+conf≥low→ALIGNED, else→UNKNOWN. Terminal else is
  UNKNOWN, as claimed.
- `analysis_key(repository, pr_number, head_sha, contract_snapshot_id,
  ANALYZER_VERSION)` verified (defined `models.py:217`; computed at
  `nodes.py:load_obligations` L76 and `persist` L258).
- Binding gate (`match_points`) and evidence validation
  (`evidence.py:validate_evidence`) descriptions match.

### Spec 30 — entity graph & derived layers

- The fold: `graph_state(diffs)`, diff log `graph/diffs.yaml`, never stored
  — verified.
- Two writers `append_proposals` / `decide`; open cap
  `MAX_OPEN_PROPOSALS = 5`; `REJECT_REASONS`, `compute_stakes`,
  `resolve_entity` (supersession receipt), `Supersede` enumeration — all
  present and matching the rule table (rules 5–10).
- atoms kinds `born · declined · returned · superseded · taught · flip`
  all present in `atoms.py`; "returned" detection via rejected member-sets
  (`members in promise_sets_rejected`) — verified.
- relevance thresholds **floor 0.10, margin 1.2** match `_SEMANTIC_MIN` /
  `_SEMANTIC_MARGIN`; TF-IDF + char 4-grams (`_terms`) — verified.
- mind: two-phase, `validate_mind`, cache `mind.yaml` on sha256 of corpus,
  `read_mind_cache` — verified.
- story: `validate_story` + faithfulness judge; cache `stories.yaml` keyed
  on `_file_sig` + `_analyses_sig` + obligations-sig — verified.
- hierarchy: `derive_tree` subsumption `_SUBSUME_SHARE = 0.6`;
  `derive_ring` **seven shelves in the exact order and wording** the spec
  lists — verified against `hierarchy.py` L281–L302.
- `model.around`, `_diff_why`, `_around_entity`, moods — verified.

### Spec 00 — architecture overview

- Cache table (4 rows): `entity_graph.read_state` (keyed `_file_sig`),
  `timeline.cached_timeline` (keyed `_analyses_sig`), `story.get_story`,
  `mind.get_mind` — all functions exist with the claimed keys.
- Trust-tier module assignments all resolve to real modules/functions.

### Spec 40 — extending the graph

- `HoldingKind` is at `entity_graph.py:48` (spec says :48) with values
  `promise · code · doc · ticket · decision · incident · check` — exact.
- `Relate.relation` is at `entity_graph.py:92` (spec says :92),
  `Literal["part_of", "depends_on"]` — exact.
- Worked example correctly describes `sessions.py` as **new** — the file
  does not yet exist (verified absent), so the spec is honest.
- `Fake<Thing>` twins exist for every LLM class (pattern e) — verified.
- `grouping.py` link-community citation (Ahn/Bagrow/Lehmann) present.
- Referenced docs exist: `2026-07-19-navigator-design.md`,
  `2026-07-19-top-level-structure.md`, `2026-07-19-story-layer-design.md`.

**Total: ~60+ discrete claims walked to source; all held except the one
fixed below.**

---

## (B) Spec claims FIXED

### 1. Spec 20 legend — the "all wrapped in `invoke_with_retry`" overclaim

**Which:** `docs/specs/20-llm-call-sites.md`, the Legend paragraph.

**What was wrong:** the legend asserted "all wrapped in
`llm_retry.invoke_with_retry`". This is false for three of the 17 call
sites, which call `.invoke` directly:
- #11 `mind._thinker` (phase 1) — `self._thinker.invoke` (deliberate: free
  prose, no schema, nothing to validate/retry).
- #15 `ask.haiku_pick` — `model.invoke(prompt)` (`ask.py:189`).
- #16 `evals.seed_quality._haiku_complement_judge` — `model.invoke`
  (`seed_quality.py:162`).

A diligence engineer grepping `invoke_with_retry` against these three
lines would catch the discrepancy immediately.

**Correction:** rewrote the legend to name exactly which calls wrap in
`invoke_with_retry` (pipeline, onboarding, seeding, grouping,
mind-structurer, story, repo-cognition) and which three call `.invoke`
directly, with the reason for #11. The per-row content was already
accurate; only the sweeping legend claim was corrected.

*(No other spec claim required a fix. The relevance "floor 0.10, margin
1.2" — a plausible candidate for confusion with `ask.py`'s 0.18/1.5 — was
verified CORRECT: those are `relevance.py`'s own constants, distinct from
the lexical rung's, and the spec cites the right pair.)*

---

## (C) Dead code REMOVED

### 1. `quire/static/mirror.html` — orphaned page (160 lines)

**Proof it was dead:**
- `grep -rn "mirror.html"` across `quire/ tests/ evals/ docs/specs/`
  → **zero** references outside the file itself.
- No route serves it: `api.py` serves `app.html`, `inbox.html`,
  `intent.html`, `onboard.html` via `read_text()`; there is no
  `read_text` of `mirror.html`.
- The `/mirror/{workspace}` route (`api.py:375`) now issues a
  `RedirectResponse` to `/app/{workspace}` (307) — the mirror's uniques
  were folded into the map overview in the 2026-07-19 UX pass. It does not
  serve the file.
- `test_cli_api.py:106` positively asserts `/mirror/quire-brain` is **not**
  a door — consistent with the page's retirement. No test 404s on it.
- The live mirror *data* path (`build_mirror`, `/api/mirror/{workspace}`)
  is NOT dead — it feeds the status-question ask route (`api.py:455`) and
  `app.html:437`'s recent-checks panel. Only the standalone HTML page is
  orphaned. (The prompt's hypothesis confirmed exactly.)

**Removed:** `git rm quire/static/mirror.html`. Tests stay green
(201).

### 2. `quire/analysis/config.py:78` — dead `DEFAULT` name binding

**Proof it was dead:** `grep -rnw "DEFAULT" quire tests evals`
returns **only** the definition line — the name `DEFAULT` is read nowhere.
The default variant is consumed via `get_variant("linear-v1")`, never via
`DEFAULT`.

**What was deleted:** the dead `DEFAULT =` binding only. The right-hand
side `register_variant(AnalyzerConfig())` is load-bearing (it registers the
`linear-v1` variant into `_VARIANTS`), so it was preserved as a bare call:
`register_variant(AnalyzerConfig())  # the default "linear-v1" variant`.
Zero behavior change: verified `get_variant("linear-v1")` still resolves;
201 tests green.

---

## (D) Findings NOT actioned (round 2 candidates)

These are judgment calls or out-of-scope; left for the owner to decide.

1. **`story._load_cache` cross-module private import** (backlog item).
   `api.py:750` imports and calls the underscore-private
   `story._load_cache`. This is a real encapsulation smell (a private
   helper reached across a module boundary), but the function is **NOT
   dead** — it is `story.py`'s own cache reader (used at `story.py:397`)
   AND api.py's read path. The clean fix is a public
   `story.read_story_cache(...)` accessor mirroring
   `mind.read_mind_cache`; that's a small refactor with behavior to
   re-test, so it belongs in a dedicated tick, not a spec-reconciliation
   pass. **Recommend round 2.**

2. **`enrich_workspace` redundant regroup** (`graph_heuristics.py:194`).
   `load_group_state(workspace_dir, adapter)` is invoked at L176 (bound to
   `state`) and AGAIN at L194 inside the return dict, recomputing the same
   groups. Not dead code and not a correctness bug (results are
   deterministic), but a wasted second grouping pass. The L194 call could
   reuse a single regroup-after-write result. Left for round 2 — it's an
   efficiency cleanup, not a spec/deadness issue.

3. **`_resolve_port` swallowed errors** (`cli.py:619`, backlog item). Has a
   live caller (`cli.py:563`); the concern is error-handling quality
   (swallowed exceptions), not deadness. Out of scope for spec
   reconciliation; note for a robustness pass.

4. **Pre-existing uncommitted docstring edit** in
   `evals/seed_quality.py` (`eval_scope_honesty` docstring updated from
   "twice its membership" to ">= 0.6 of the corpus"). This was already in
   the working tree before this review began — NOT made by this pass, and
   consistent with the code (`_CORPUS_NAME_SHARE = 0.6`). Left untouched;
   flagged so the parent knows it is a separate change to land or discard.

---

## (E) Reconciliation verdict

**The specs and the code are one thing** — to a degree that materially
exceeds the usual spec-vs-code drift. Of ~60 discrete claims walked to
source across five files, exactly **one** was inaccurate (the spec-20
legend overclaim), and it was a sweeping-summary phrasing, not a
per-row citation error — every one of the 17 inventory rows was already
true. The LLM inventory count (17) is correct. The pipeline topology,
the four short-circuits, the classification rules, the seven ring
shelves, the fold's rule table, and every cited constant (0.6, 0.10, 1.2,
5, 10, the model names) all hold.

Dead code exposed by the audit was minimal: one orphaned HTML page and one
dead name binding — both removed cleanly with tests green. The
higher-value candidates the specs *hint* at (`build_mirror`, the
`/api/mirror` route) turned out to be **live** on inspection, exactly the
"check before removing" the prompt demanded.

**Is another round needed?** For claim-correctness: **no** — the specs now
grep-clean. For code hygiene: **one small round 2** is warranted to action
the three non-dead-but-smelly findings in (D) (the `_load_cache`
cross-module private, the `enrich_workspace` double regroup, and the
`_resolve_port` error swallowing) — none of which undermine the diligence
story, but all of which would make the "provably clean" claim airtight.
