# 00 — Architecture Overview

Layered technical spec of Quire's data/analysis pipeline. Every claim
traces to code (`quire/…`, file:function). Companion specs:
[10 analysis pipeline](10-analysis-pipeline.md) ·
[20 LLM call sites](20-llm-call-sites.md) ·
[30 graph & derived layers](30-graph-and-derived-layers.md) ·
[40 extending the graph](40-extending-the-graph.md).

## One-line summary

Deterministic code decides what an LLM may see and whether it told the
truth; the LLM decides only what the knowledge means — so every claim
on a screen walks to a check receipt, a verbatim quote, or a signature.

## The three trust tiers (PRD §2)

```
TIER 1 — SIGNED RECORD (never overridden; the only believed layer)
  entity_graph.py         the fold: entities = f(approved diffs), never stored
  models.py               Obligation / Binding / ControlPoint contract
  store.py                PRAnalysis (checks), snapshots, contracts — SQLite
  → mutated ONLY by entity_graph.decide / append_proposals and human sign-off

TIER 2 — MECHANICAL / DERIVED (recomputable, never authoritative)
  atoms.py                pre-cited plot events from the fold + timeline
  relevance.py            connection-content vectors (TF-IDF + char n-grams)
  hierarchy.py            derive_tree (subsumption) + derive_ring (7 shelves)
  timeline.py             per-promise verdict fold over stored checks
  grouping.py             link-community clustering (Ahn/Bagrow/Lehmann)
  model.py                around(): the read surface both clients consume

TIER 3 — LLM-HEURISTIC (schema-caged, cached, always below tier 1)
  analysis/llm.py         delta + obligation-impact reasoning (Sonnet)
  propose.py              obligation/binding extraction from docs (Sonnet)
  entity_propose.py       entity seeding + doc-complement judge
  graph_heuristics.py     area naming / pair adjudication / question routing
  mind.py                 two-phase free thinking → structured nodes
  story.py                cited narration + faithfulness judge
  ask.py                  term resolution (Haiku pick, last rung only)
```

**Rule, absolute:** nothing a tier-3 call produces enters tier 1 without
(a) mechanical validation and (b) a human signature. See §"invariants".

## Offline vs online split

Understanding is **computed on events**; answers are **composed on
questions**. Nothing expensive happens at read time.

```
ON EVENT (a check lands / a diff signs / a human teaches / contract changes):
  analysis pipeline runs      → analysis/graph.py:run_analysis  (1 check = ~1 Sonnet)
  atoms recompute             → atoms.py:atoms_for              (deterministic)
  relevance vectors drift     → relevance.py:node_documents     (deterministic)
  mind re-sweeps              → mind.py:get_mind                (only if inputs changed)
  story retells               → story.py:get_story              (only if inputs changed)

ON QUESTION (a human/agent reads or asks):
  focus / walk                → model.py:around                 ZERO LLM, cached fold
  resolve a name              → ask.py:ask ladder               ≤1 Haiku, last rung only
  render map / ring / rail    → hierarchy.py:derive_ring        ZERO LLM, cached
```

Cost scales with **change rate**, not repo size (scale dossier
2026-07-20: pydantic, 5,602 commits, flat ~48 s/check, ~$1 onboarding).

## Data flow (raw → clients)

```
raw source            adapters/{git,github,fixture}.py   commits, PRs, files, docs
  │
  ▼ onboard (assisted, human-approved)
contract              propose.py → onboard.write_workspace   obligations.yaml,
  │                                                          bindings.yaml, sources.yaml
  ▼ per PR/commit
check                 analysis/graph.py:run_analysis     PRAnalysis in store (SQLite)
  │                   (verdict + per-promise impacts + validated citations)
  ▼
signed map            entity_graph.py fold               diffs.yaml → entity state
  │                   (LLM proposes groupings; human signs)
  ▼ derived (tier 2/3, disposable)
  ├ timeline.py       per-promise standing now (state_after)
  ├ atoms.py          plot events, each pre-cited
  ├ relevance.py      meaning vectors
  ├ mind.yaml         unsigned thinking (mind.py)
  ├ stories.yaml      cited narration (story.py)
  └ hierarchy.py      the tree + the seven-shelf ring
  ▼
read surface          model.py:around · api.py            one composition, two clients
  │
  ├─ human            static/app.html  (map, navigator, inbox, ask, constellation)
  └─ agent            MCP contract (docs/2026-07-19-navigator-design.md);
                      quire_around/record/story/receipt/mind; propose is attributed,
                      sign/decline has NO tool — signing is human-only
```

## Cache layer & its invariants (added 2026-07-20, scale-run driven)

| cache | module:fn | key | invalidation |
|---|---|---|---|
| folded read state | `entity_graph.read_state` | `graph_file` mtime+size (`_file_sig`) | a write changes the file signature → miss |
| built timeline | `timeline.cached_timeline` | `(len, per-row analysis_id+review_state)` (`_analyses_sig`) | any check add or `update_review` → miss |
| story | `story.get_story` | sig of diff log + analyses + obligations | any input signature change → retell |
| mind | `mind.get_mind` | sha256 of the corpus text | corpus change → resweep |

**Read-only contract** (`entity_graph.read_state` docstring): callers of
`read_state` must never mutate the returned `diffs`/`state`; writers
(`append_proposals`, `decide`) always load fresh via `load_diffs`. A
mutation grep over all adopters (atoms, model, hierarchy, relevance, api)
confirmed compliance (quality tick `b376384`).

## The invariants every layer upholds

1. **One mutation path** — tier 1 changes only through
   `entity_graph.decide`/`append_proposals`; the decision endpoint is the
   sole writer (PRD rule 5).
2. **No quote, no render** — a claim that can't cite its source is
   dropped, not shown (`analysis/evidence.py:validate_evidence`,
   `story.py:validate_story`, `entity_propose._validated`).
3. **Citations resolve or the sentence dies** — `story.validate_story`,
   `mind.validate_mind` drop any output referencing a ref that doesn't
   exist in the universe.
4. **Code never creates intent** — obligations come only from approved
   docs (`models.Obligation` docstring); analysis reads the contract, never
   writes it.
5. **Machines propose; humans sign** — tier 3 output is always a proposal
   or a phrasing, never a believed fact, until a named human signs.
6. **Model choice follows the understanding requirement, not tier dogma**
   — judges guarding truth run on Sonnet even where Haiku would be cheaper
   (memory: trust-the-lm; see [20](20-llm-call-sites.md)).
