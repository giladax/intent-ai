# 30 — The Entity Graph & Derived Layers

The signed record (tier 1) and every derived layer (tiers 2/3) built on
it. See [00 overview](00-architecture-overview.md),
[40 extending](40-extending-the-graph.md).

## The fold (`entity_graph.py`)

**Entity state is never stored — it is always a pure fold over approved
diffs** (`graph_state(diffs)`). The diff log (`graph/diffs.yaml`) is the
immutable history; `graph_state` replays approved diffs in decision-instant
order and applies each operation.

### Operations (`Operation` union)

`CreateEntity · Attach · AddAlias · Rename · Relate · Detach · Supersede`.
Each `GraphDiff` carries `operations`, `evidence` (verbatim quotes),
`reasoning` (kept on the node — shown to humans, embedded into vectors),
`stakes`, `shape_key`, `status ∈ {open, approved, rejected}`, and a
`Decision` (by/at/reason/amended/final_operations).

### The two writers (the ONLY tier-1 mutation path)

- `append_proposals(dir, proposals, now, human=False)` — mints diff ids,
  enforces the open cap (5) and rejected-shape suppression; `human=True`
  bypasses the cap and machine-shape suppression (a person revisiting a
  rejection is a new decision, not machine noise).
- `decide(dir, diff_id, action, by, now, …)` — the single decision path:
  approve validates against current state first (fails loudly, mutates
  nothing on integrity error); reject requires a structured reason;
  edited approval recorded `amended` with `final_operations`.

### The twelve-rule enforcements (mechanical, in code)

| rule | enforcement |
|---|---|
| 5 one mutation path | only `append_proposals`/`decide` write; the fold is pure |
| 6 structured rejection | `REJECT_REASONS`; `suppression_reason` — reason-aware (wrong_name kills the name, not_one_thing kills the grouping) |
| 7 amended = human-amended | `decide` compares final ops **by value** (not the lossy shape key) |
| 8 blast radius | `compute_stakes` — one number drives both inbox order and label |
| 9 retired names forward | `resolve_entity` follows supersession chains to the LIVE successor, with receipt |
| 10 supersession freezes legibly | `Supersede` must enumerate the fate of EVERY live promise or `decide` raises |

Reads use `read_state(dir)` → `(diffs, folded state)`, cached on the diff
file signature; **callers must not mutate the returned objects** (writers
load fresh).

## Derived layers

Each is disposable, recomputed on input change, never read by the fold,
never authoritative.

### atoms (`atoms.py:atoms_for`)

- **Input:** `read_state` diffs + `cached_timeline` events.
- **Rule:** deterministic decomposition into pre-cited plot events —
  `born`, `declined` (with teaching), `returned` (a rejected grouping back
  under a new shape, detected via rejected member-sets), `superseded`,
  `taught`, `flip` (verdict change incl. recoveries).
- **Honest by:** every atom carries its citations (`_cite`); the LLM
  phrases atoms, never reads raw tables — which is why story/mind citations
  almost never drop. Declined atoms are phrased so the refused proposal's
  own wording can't be read as the ground for refusal.

### relevance (`relevance.py:node_documents`, `resolve_semantic`)

- **Input:** per active entity — name, identity, aliases, member promise
  statements, **signed-diff reasoning**, bound code/doc paths, its atoms,
  and the mind's thinking about it (cache-only).
- **Rule:** TF-IDF over word tokens **plus character 4-grams** (so "risky"
  meets "risk" without a dense-embedding dependency; interface ready for
  one). Resolve only with a clear winner (floor 0.10, margin 1.2); else
  **refuse and name the nearest by meaning** — a match that can't show its
  wording doesn't resolve.
- **Retires the alias table as load-bearing:** the vector is the bridge
  from dialect to map; each teaching enriches it (nearby phrasings resolve
  untaught); aliases survive as confirmed display vocabulary.

### mind (`mind.py:get_mind`)

- **Input:** the whole corpus (`_corpus_and_universe`); the previous
  sweep's nodes (evolution, not restart).
- **Rule:** two-phase — free prose thinking, then structured extraction.
  Any node kind, no cap, no ceremony. **`validate_mind`** drops any
  connection that doesn't resolve to a real ref; a node whose connections
  all drop was about nothing.
- **Triage & lifecycle:** every node self-triages
  important/ambiguous/probably-noise; sweeps **evolve** (re-derived
  thoughts keep their birthday; vanished ones recorded `faded`; retired
  ones carry a why); human **dismissals** (`dismiss_thought`) are signed
  and stay dead across sweeps unless the evidence is new.
- **Cache/staleness:** `mind.yaml`, keyed on sha256 of the corpus text.
- **Not tier 1:** a mind node that earns belief becomes a proposal;
  nothing here binds until a human signs.

### story (`story.py:get_story`)

- **Input:** labeled facts assembled from atoms + health + check findings
  (scoped: org = whole workspace; entity = one entity's atoms).
- **Rule:** Sonnet narrates with per-sentence structured citations.
  **`validate_story`** drops any sentence whose citations don't all resolve
  (normalizing by shape — `check #7` → check 7); `because` requires a
  reason-bearing cite. Then the **faithfulness judge** (Sonnet) drops
  sentences the facts don't support; the count is shown in the byline.
- **Cache/staleness:** `stories.yaml`, keyed on the **signatures** of the
  diff log + analyses + obligations (facts built only on a miss). A story
  that loses every sentence renders as *no story* — a missing story is
  honest; a hollow one is not.

### hierarchy (`hierarchy.py`)

- **`derive_tree`** — the project is the root; explicit `part_of` nests
  first, then **subsumption** (an entity whose world is ≥0.6 contained in a
  bigger entity's world nests under it), then rank by promise count
  (connectors float up). No bare words (every node carries its context
  path); no orphans (unplaced promises → a visible "not yet placed" branch;
  unanchored thoughts → "open threads").
- **`derive_ring`** — the constant ring (CPO structure
  `docs/2026-07-19-top-level-structure.md`): 7 shelves in fixed order
  (What we build / What we promised / What's changing / What needs a human
  / What the mind wonders / What has no home / Who and where). **Grammar
  constant, membership dynamic** — each shelf orders by its own law
  (subsumption, doc structure, time, stakes, salience); the subsumption
  tree lives inside shelf 1 and only there (thoughts keep their canonical
  shelf, no double-shelving).

### model.around (`model.py:around`) — the read surface

- **Input:** any ref (entity id / promise id / GD-N / check number /
  mind-node name incl. retired/dismissed).
- **Output:** a focus card + typed neighbors, each with its **mood**
  (signed / proposed / observed / thought / declined) and its **why** (the
  reasoning on the edge). `_diff_why` degrades honestly: kept reasoning
  when it exists, else the evidence the proposal stood on (pre-reasoning
  diffs still have custody — quotes, not invented thoughts).
- **Zero LLM at view time**; folds via `read_state` + `cached_timeline`.
  This is the composition both the human UI and the MCP surface consume —
  one brain, two clients.

## The honesty properties, collected

- **No orphans** — hierarchy renders every promise/thought somewhere,
  gaps named as gaps.
- **Citations resolve or die** — atoms/story/mind all validate refs
  against the real universe.
- **Reasoning kept on nodes** — diffs and mind nodes carry the thinking
  that produced them; it shows to humans and feeds the vectors and the
  next sweep. Claim + evidence + reasoning is the shape a future source (a
  Claude session) attaches with — see [40](40-extending-the-graph.md).
