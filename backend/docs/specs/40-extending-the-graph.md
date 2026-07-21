# 40 — Extending the Graph

How to add capability without breaking the invariants that make Quire
trustworthy. Read [00](00-architecture-overview.md),
[30](30-graph-and-derived-layers.md) first. Every extension answers three
questions: **which trust tier does it land in? what mechanically keeps it
honest? who signs?**

## The invariants you may never break

1. **One mutation path.** Tier 1 changes only via
   `entity_graph.decide`/`append_proposals`. New data becomes a *proposal*;
   a human signs.
2. **No quote, no render.** Anything asserting a fact must cite a source
   that mechanically resolves (verbatim quote, file:line, check, decision).
3. **Citations resolve or the output dies.** New derived/LLM layers must
   validate their refs against the real universe (the `validate_*` pattern).
4. **Code never creates intent.** Only approved documents produce
   obligations. Analysis reads the contract; it never writes it.
5. **No LLM output enters tier 1 unvalidated.** Propose → validate → human
   signs. Never trust a model into the believed layer.

### Anti-patterns (rejected in code review, historically)

- **Regex for anything semantic** (CLAUDE.md). Structural parsing (ids,
  paths, JSON) is fine; classification/intent/topic-shift is an LLM with
  structured output. Regex may only be a *logged offline fallback*
  (`graph_heuristics.route_question`).
- **Silently dropping data.** If a layer bounds coverage (a cap, a filter,
  a sample), it must SAY what it dropped (`dropped_citations`, story
  "N withheld", the "not yet placed" branch). Silent truncation reads as
  "covered everything".
- **A cache key that misses an input.** Every derived cache keys on the
  signature of ALL its inputs (the story key once missed obligations —
  caught by the quality loop). Verify inputs honestly.
- **Mutating a `read_state` return.** Poisons the fold cache for all
  readers. Writers load fresh via `load_diffs`.

---

## (a) A new holding kind / node type

`HoldingKind` (`entity_graph.py:48`) is a `Literal` — today
`promise · code · doc · ticket · decision · incident · check`.

1. Add the value to the `Literal`.
2. Teach the read surface: `model.py:around` groups holdings by kind into
   moods — add its mood/section (`_around_entity`).
3. Teach `hierarchy.py` if it belongs on a shelf (e.g. a new
   `whats-changing` source), and `_is_doc_path`/counting if it's
   document-like.
4. If it carries provenance, add a validation gate (does the ref resolve?).
5. **Tests:** an `Attach` of the new kind folds correctly
   (`test_entity_graph`); the read surface renders it; hierarchy places it.

## (b) A new edge relation

`Relate.relation` (`entity_graph.py:92`) is `Literal["part_of",
"depends_on"]`.

1. Add the value.
2. `hierarchy.derive_tree` uses `part_of` for nesting — decide if the new
   relation nests (structural) or is a lateral link (rendered, not nested).
3. `model.around` renders relations as neighbors both directions — add its
   label/inverse.
4. `_op_signature` (shape key) already handles `relate` generically.
5. **Tests:** the relation folds; `resolve_entity` and the ring/tree place
   it right; the shape key dedupes it.

## (c) A new evidence source (the source-agnosticism proof)

The extension rule (PRD §2): **any new signal is a new edge type landing
in exactly one trust tier with provenance; algorithms and trust rules do
not change.** Git co-change, Jira, Slack, a Claude session — all the same
shape.

1. **Adapter or ingest step** produces facts with provenance (who/when/
   where). Follow `adapters/` for a source; a one-shot importer is fine.
2. **Land it in ONE tier:**
   - human-asserted (a person linked it) → tier 1, via a proposal.
   - mechanical (co-change frequency, a verified citation) → tier 2, a
     derived edge, recomputable.
   - LLM-inferred (a session's analysis) → tier 3, a proposal or a
     reasoning-bearing node, never believed until signed.
3. **Attach with a resolving ref** — a `Connection`/citation whose ref is
   real (an entity id, promise id, path, check, decision).
4. **Never let it write intent** (rule 4) or enter tier 1 unsigned (rule 5).

## (d) A new derived layer

Model it on atoms/relevance/story:

1. Pure function of the fold + stores; **never read by the fold**.
2. Cache in `workspaces/<ws>/<layer>.yaml`, keyed on the **signatures** of
   every input (reuse `entity_graph._file_sig`, `timeline._analyses_sig`).
3. Disposable — safe to delete; regenerates on input change.
4. If it renders claims, add a `validate_<layer>` that drops anything
   whose refs don't resolve.
5. Surface it in `model.around` and/or `hierarchy` so it's navigable.

## (e) A new LLM heuristic (propose-validate discipline)

1. A `<Thing>LLM` class with a `Fake<Thing>` twin (offline + tests).
2. `.with_structured_output(Schema)`, wrapped in
   `llm_retry.invoke_with_retry`.
3. **A deterministic gate decides what survives** — the pattern is
   universal here: `validate_candidates` (quotes), `validate_story`
   (citations), `validate_mind` (connections), `_wrong_scale` (guard).
   Never render raw model output.
4. Model per the understanding requirement, not tier dogma (Sonnet for
   truth-guarding judges; Haiku for recoverable classification).
5. If it's a judge, phrase it **independently** of any mechanism it grades,
   and give it a calibration set (blind-subagent-eval playbook).

## (f) A new MCP tool (the shared-brain contract)

The MCP surface wraps the SAME composition endpoints the human UI reads
(`docs/2026-07-19-navigator-design.md`). One brain, two clients.

1. Read tools wrap `model.around` / `story` / `mirror` / `mind` — no
   privileged agent data, no privileged human data.
2. Write tools go through `teach`/`append_proposals` with attribution
   (`proposed_by="agent:<session>"`) — an agent proposes, never asserts.
3. **`sign`/`decline` has NO tool. Signing is human-only.** This is the
   product's spine; do not add an agent path to it.

---

## Worked example: add a Claude session as a reasoning-bearing source

Goal: a coding session's analysis attaches to the map as a source node —
claim + evidence + reasoning — the same shape every node already has.
Because reasoning is already first-class (`GraphDiff.reasoning`,
`ConceptNode.reasoning`), this needs no model change — only an ingest
path and a tier decision.

**Tier decision:** a session's *observations* are LLM-inferred → tier 3
(the mind or a proposal), never believed until signed. A session's
*artifacts* it touched (files, commits) are mechanical → they attach as
existing `code`/`check` refs.

**End to end:**

1. **Ingest** (`quire/sessions.py`, new): read the session transcript
   (adapter-style), extract per-topic `{claim, touched_refs[], reasoning}`.
   Structural extraction (ids, paths) is deterministic; the *claims* are an
   LLM heuristic with a `FakeSessionReader` twin (pattern e).
2. **Validate** each claim: its `touched_refs` must resolve against the
   universe (`_corpus_and_universe`-style set) — drop refs that don't
   (invariant 3). A claim with no resolving ref was about nothing; drop it.
3. **Land it — two honest options:**
   - *As mind input* (cheapest): write the session's surviving claims into
     the corpus `mind.get_mind` reads, tagged with the session id as a
     ref. The mind evolves them, triages them, `validate_mind` keeps them
     honest, a human dismisses noise. Nothing signed.
   - *As a proposal* (stronger): mint a `GraphDiff` with
     `proposed_by="agent:session-<id>"`, `reasoning=<the session's own
     reasoning verbatim>`, `evidence=[quotes with the transcript as
     source]`, operations = `Attach(kind="decision", ref="session-<id>")`
     to the entities it touched. It appears in the inbox; a human signs or
     declines; the diff log keeps the receipt.
4. **It joins the memory automatically:** once signed, its `reasoning`
   flows into the entity's relevance vector
   (`relevance.node_documents` already reads signed-diff reasoning), so the
   words the session used become part of how that entity is found — and the
   next mind sweep reads it. No new plumbing.
5. **The read surface shows it free:** `model.around` already renders a
   `decision`/reasoning-bearing neighbor with its mood and why; a session
   node walks like any other hop — claim → its reasoning → the refs it
   touched → who signed it.
6. **Tests:** session ingest drops unresolvable refs; a signed session
   proposal folds and appears on the touched entities; its reasoning
   resolves the entity by meaning (`resolve_semantic`); an unsigned session
   claim never mutates tier 1.

**Why this is the whole thesis in one extension:** a Claude session is
"just another reasoning-bearing node." The trust machinery — validate the
refs, keep the reasoning, let a human sign — is identical whether the
source is a PRD, a commit, a Slack decision, or an agent's own thinking.
The moat is the machinery, not the source list.

## New-extension checklist (paste into the PR)

- [ ] Which trust tier? (1 needs a signature; 2/3 are disposable.)
- [ ] What resolving ref/quote keeps it honest? (invariants 2, 3)
- [ ] Cache key covers ALL inputs? (`_file_sig`/`_analyses_sig`)
- [ ] No regex for semantics; no silent drops; no tier-1 write unsigned.
- [ ] Fake twin for offline tests; deterministic gate on any LLM output.
- [ ] Surfaced in `model.around`/`hierarchy` so it's navigable.
- [ ] Tests: folds, renders, validates, and refuses the dishonest case.
