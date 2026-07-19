# Stakeholder review — round 1 (2026-07-19)

**Under review:** the story layer (spec `docs/2026-07-19-story-layer-design.md`,
`quire_align/story.py`, `/api/story/*`, lede + story-so-far), the relevance
architecture (`quire_align/atoms.py`, `quire_align/relevance.py`, the semantic
ask rung), the constellation (`#/constellation`, owner-amended rule 11).

**Method:** live server on :8357 against the `quire-brain` workspace; curl
transcripts; Playwright screenshots in
`/private/tmp/claude-501/-Users-giladkoch-dev-intent-ai/be3b52e6-798b-4c35-b281-2645489c7131/`
(01-home, 02-record-feature, 03-constellation, 06/07 story close-ups,
08-ask-miss-rendered, 09-ask-semantic-rendered). Test suite: 172 passed.
Note: viewing the record pages caused the product itself to regenerate
`workspaces/quire-brain/stories.yaml` (its designed lazy-retell behavior) —
no decision, teach, or code change was made by this review.

---

## CPO — NOT SATISFIED

1. **[HIGH] The live org lede states a falsehood about who-signed-what-amended.**
   The home lede reads: *"…then signed GD-2, GD-3, GD-4, and GD-5 — the last
   two after edits — seating four names on the map that day."* The record shows
   GD-3 `amended: True`, GD-5 `amended: True`, GD-4 `amended: False`
   (`workspaces/quire-brain/graph/diffs.yaml`; verified via `load_diffs`:
   GD-1 rejected/False, GD-2 False, GD-3 **True**, GD-4 False, GD-5 **True**).
   "The last two" is wrong — the labeled facts fed to the model were correct
   (`story.py:191` marks "(edited before signing)" per diff), the model
   compressed them wrongly, and `validate_story` (`story.py:155`) can only
   check that citations *resolve*, not that the sentence's content matches
   them. Rule 7 (edited approvals are recorded human-amended) is being
   mis-narrated on the front page. Per the standing eval bar ("a story eval
   lands when the first real defect is observed," design doc §4), **this is
   the first real defect — the story-content judge is now owed.**

2. **[HIGH] Taught vocabulary and exact entity names lose to the status router
   when the LLM is live.** Evidence (curl, live key):
   - `?q=Features` (a signed alias of Feature) → `method: status`, answer =
     "6 product areas: Write Governance (3 promises); …"
   - `?q=understanding` (a signed alias of Current Understanding) → same.
   - `?q=current understanding` (the exact entity NAME) → same.
   With `llm=false` all three resolve `method: entity` to the right record.
   The ladder in `api.py` runs status routing (line 404) before the entity
   rung (line 420), so a Haiku router misfire on a bare noun swallows signed
   names. The teach loop's receipt is broken at the front door: the founder
   signs "Features" into vocabulary and the ask answers with an area dump.
   (PRD §Ask: "Status questions never resolve to a single entity" — a name is
   not a status question.) Fix direction: exact name/alias resolution before
   status routing, or give the router the entity vocabulary.

3. **[MEDIUM] Rule 4 is violated in the constellation.** Current Understanding
   holds 3 promises, all unexercised (`/api/graph/quire-brain` rollup:
   `{contradicted: 0, partial: 0, kept: 0, unexercised: 3}`), yet it renders
   with the same calm dark-ink ring as a fully-kept entity (`app.html:630`
   `tone()` returns ink for anything not contradicted/partial), and the legend
   (`app.html:569-571`) has no unexercised mark. "Never-checked is its own
   verdict… legend on every surface using it" (PRD rule 4). Screenshot
   03-constellation.png: Current Understanding reads as *holding*, not as
   *never checked*.

4. **[MEDIUM] The owner's amendment to rule 11 is recorded nowhere but a
   commit message.** `docs/PRD.md:72` still says "**No node-link canvas,
   ever**" and `docs/PRD.md:108` "Not building: any canvas";
   `docs/2026-07-18-entity-experience-spec.md:77` says "canvas (banned
   forever)". The amendment ("the ban stays on canvases that EDIT or replace
   the IA; a navigational view is presentation") exists only in commit
   d12d5fa's message. The product source of truth contradicts a live surface;
   the amendment must be written into the PRD with its date and owner.

5. **[LOW] Refusals name internal ids, not wording.** A miss renders "Nearest
   by wording: G1, G2" (screenshot 08-ask-miss-rendered.png; `app.html:784`).
   Rule 3 says refusals name nearest-by-wording — G1/G2 are derived group ids
   the founder has never seen. Also the semantic rung's near-misses (real
   entity names with scores) are discarded on refusal (`relevance.py:110`
   returns None) instead of feeding the "nearest" line.

**What holds:** the semantic rung's refusal honesty is good — nonsense
("banana smoothie") refuses at 0.0; genuinely ambiguous phrasing ("canonical
response", shared across records) refuses on margin rather than guessing.
No DECLINED proposal is narrated as concluded — the lede narrates GD-1 as
refused with its recorded ground; no motive, no prediction found in the live
stories. The alias rework preserves the teach receipts: `teach_alias` mints
a signed diff through the log with an evidence quote (`teach.py:80-95`),
aliases persist as display vocabulary on the record, and each teaching
enriches the vector (`relevance.py:72`, pinned by
`test_teaching_enriches_the_vector`).

## CTO — NOT SATISFIED

1. **[MEDIUM] The claimed architecture is not the built architecture.**
   `atoms.py:7-9` says atoms "are what stories, answers, and relevance
   vectors compose from" — but `story.py` never imports atoms; it carries a
   parallel derivation (`_decided_facts`/`_health_facts`, story.py:178-231)
   duplicating `_decision_atoms`/`_flip_atoms` (atoms.py:31-133). Only
   `relevance.py` consumes atoms. Two narration paths will now drift — and
   already have: atoms detects returns-under-new-shape (`atoms.py:39-49`,
   GD-10 carries rejected GD-1's exact promise set {QUIREB-001, QUIREB-012}),
   which the story facts never surface (see Storyteller #2). One derivation
   should feed both.

2. **[MEDIUM] A derived, disposable cache is git-tracked and mutates on GET.**
   `workspaces/quire-brain/stories.yaml` is committed to the repo and rewritten
   whenever a story regenerates on a page view (`story.py:342`); `git status`
   shows it modified after this review merely *looked* at a record. The
   design's own words: "derived cache, never read by the fold, safe to
   delete" — then it must not live in version control (gitignore it or move
   it out of the workspace source dir). Also: `write_text` is a non-atomic
   full-file rewrite with no lock; two concurrent stale GETs (org + entity
   fire together on every home→record navigation) can duplicate Sonnet calls
   and lose one write.

3. **[LOW] Per-request recompute is already visible and grows linearly.**
   Every ask that reaches the semantic rung parses `graph/diffs.yaml` at
   least three times (api.py:419 entity rung; relevance.py:60
   `node_documents`; atoms.py:141 `atoms_for`) and rebuilds the full check
   timeline (`_flip_atoms` → `build_timeline` over all analyses); `get_story`
   rebuilds facts (including the timeline) on every request *before* it can
   test the cache hash (story.py:317-325). Measured now: ~0.9s per ask,
   ~0.86s per *cached* story read at 24 analyses / 4 entities (note: ~0.85s
   of that is a flat all-endpoint baseline — `/api/graph` costs the same —
   which predates these increments and deserves its own look). Threshold:
   timeline construction is O(checks × promises); at the current shape it
   stops being acceptable around a few hundred checks (~300–500), where
   the added recompute crosses into user-visible seconds. The fix is
   event-time derivation (persist `state_after` per check at analysis time —
   it is already computed there) or a memo keyed on analysis count; the
   interface in `relevance.py` was explicitly built to allow this without
   touching callers.

4. **[LOW] Threshold calibration is two live probes in a comment.**
   `relevance.py:29-35` documents floor 0.10 / margin 1.2 tuned on "risky
   payouts → 1.26×; nonsense → 0". The probes are partially pinned
   (`test_ask_semantic_rung_over_http`, `test_ambiguity_refuses_rather_than_guesses`)
   which meets the eval bar for now, but the margin operates on ratios of
   n-gram-inflated cosines; when the first wrong-entity resolution is
   observed, a calibration set (must-resolve / must-refuse pairs) becomes
   owed on the same rule as the story judge.

**What holds:** nothing writes into the fold's data — stories.yaml, atoms,
and vectors are all derived and fold-blind (`graph_state` never reads them);
mutation still flows only through the diff log (teach_alias included);
the citation validator is deterministic and pinned by tests
(`test_validator_is_the_law`, `test_causality_requires_a_recorded_reason`,
`test_citation_normalization_by_shape`); LLM regeneration is correctly gated
on input-hash change, so Sonnet spend is a handful of calls per active day.

## UX — NOT SATISFIED

1. **[MEDIUM] The semantic receipt shows tokenizer debris, not wording.**
   Live reply: "Read 'structured output from MCP tools' as MCP Surface —
   matched by meaning through: **ctur, mcp, ools, ruct, stru**."
   (09-ask-semantic-rendered.png). `relevance.py:113` returns
   `sorted(q_terms & doc_terms)` — alphabetical sort floats character
   4-grams to the front, and `app.html:748` shows the first five. The
   receipt is supposed to be "the wording that carried it"; show whole
   words only (the grams are mechanism, not wording).

2. **[MEDIUM] Chip walls interrupt the prose.** Lede sentences 2 and 3 carry
   5 and 7 consecutive citation chips (06-home-lede-closeup.png) — a run of
   mono tokens mid-paragraph that breaks the reading line. Contributing
   cause: `story.py:245` invites the model to cite the standing-count fact
   with *every* approved diff. One or two chips per sentence read as margin
   notes; seven read as a register. Cap the invitation (cite the count to
   nothing, or to the collation) or collapse runs ("GD-2…GD-5").

3. **[MEDIUM] Chips don't land on receipts.** A check chip (`#7`) links to
   `/api/checks/...` which serves raw JSON (`app.html:690`; verified
   content-type application/json) — a founder tapping a sentence lands in an
   API payload. A diff chip links to the whole inbox (`app.html:696`), not
   the specific decided card (design §3: "GD chips open the decided card";
   the decided section exists in inbox.html:134 but there's no anchor). The
   promise chips deep-link correctly.

4. **[LOW] Ask gives no acknowledgment and stacks stale replies.** Enter →
   1–4s of nothing (router + rungs), no pending state; an earlier slow answer
   can land after a newer question and stack above it (observed:
   05-ask-semantic-hit.png shows the "banana smoothie" miss and the semantic
   hit rendered together; `app.html:725-731` has no in-flight guard).

5. **[LOW] Home rhythm is banner → story; the design says story → banner →
   structure** (design doc §3 "Rhythm"). The banner is pinned above the
   headline in the fixed masthead region (`app.html:145`), the lede lives
   under the h1 (`app.html:277`). Defensible (triage above narrative), but
   it is a deviation from the signed spec — either amend the spec line or
   move the banner.

6. **[LOW] The constellation at 4 nodes is honest but thin, and its legend
   describes things that aren't there.** One faint thread, no solid threads
   (no signed relations exist yet), star sizes r=14 vs r=17 are
   indistinguishable (03-constellation.png), and the legend promises
   "solid thread — a signed relation" with zero on canvas. It earns its
   read-only door (calm, navigable, nothing edits), but it currently teaches
   less than the home grid; the rule-4 color gap (CPO #3) is the one defect
   in it that must be fixed rather than waited out.

**What holds:** the story sits comfortably above the grid in body type —
prose first, evidence one touch away; the record reads identity → story →
quires → promises in the designed order; the miss reply's two-chip teach
path ("another name for something here" / "propose it") is clear; the
semantic-hit teach is one line and one chip — it teaches without nagging;
"never a spinner where prose was" holds on every story surface.

## STORYTELLER — NOT SATISFIED

1. **[MEDIUM] The lede's best material is missing: the custody-boundary
   return.** The spec's example C — the paragraph this feature was sold on —
   ends "*among them the custody boundary, back under its third name*". The
   live lede ends with a five-name roll call: "Five unsigned proposals —
   Feature Resolution, Understanding Review, Raw Session Archive, Artifact
   Grounding, and External System Boundaries — sit in quires awaiting the
   cpo's hand." The arc (GD-1 refused → the teaching → the same two promises
   back as GD-10) is *computed* (`atoms.py:39-49` marks GD-10 "returned";
   its promise set {QUIREB-001, QUIREB-012} equals rejected GD-1's) but the
   story facts never mention it (`story.py:182-186` narrates open diffs with
   no return detection). The one plot the product owns — rejection teaches,
   the grouping comes back — is invisible on the page that exists to tell it.

2. **[MEDIUM] Inventory prose is back.** The same lede sentence is a list
   with prose punctuation — five names, one verb; and the Feature record's
   story narrates "GD-3, consolidating two promises and seven code locations
   under MCP Surface" (07-feature-story-closeup.png) — another entity's
   founding, with cargo counts, on Feature's page. The module's own prompt
   forbids this ("no inventory prose… one plot point per sentence,"
   story.py:93-94); the never-list needs enforcement teeth (the judge the
   CPO now owes) or tighter fact scoping (`_entity_facts` pulls in any diff
   touching a shared promise, story.py:256-264 — the spec's example A shows
   the right move: "The promise is shared with MCP Surface — both records
   carry the break").

3. **[LOW] The clerk's hands show.** "the cpo refused GD-1", "awaiting the
   cpo's hand" — the signer id leaks lowercase into literature
   (06-home-lede-closeup.png; the facts interpolate `d.decision.by` raw,
   story.py:189). A court reporter writes "the CPO". Presentation-case the
   actor names before they reach the prose.

4. **[LOW] The byline forgets why.** "told 2026-07-19" (`app.html:716-718`)
   — the design's retelling mark carries the trigger: "retold after check #8
   · 2026-07-19". The *why* is what makes the byline a receipt instead of a
   timestamp.

**What holds:** the opening is genuinely good — both live stories open on
the wound ("The MCP surface is returning prose where structured content is
required, breaking its promise since check #7"), not on inventory; tension
first, stakes implicit, no flattery, no console-voice, no "I", no motive,
no prediction; proposals are consistently marked "unsigned, in quires";
graceful degradation is real (three entities correctly have *no* story
rather than a hollow one). Sentences 1 of both the lede and the Feature
story I would sign. Sentence 4 of the lede and sentence 2 of the Feature
story I would not.

---

## Round-1 disposition

| Persona | Verdict | Blocking items |
|---|---|---|
| CPO | NOT SATISFIED | 2 high, 2 medium, 1 low |
| CTO | NOT SATISFIED | 2 medium, 2 low |
| UX | NOT SATISFIED | 3 medium, 3 low |
| STORYTELLER | NOT SATISFIED | 2 medium, 2 low |

Highest-severity thread across all four: **the validator guarantees
citations resolve, not that sentences tell the truth about them** (CPO #1),
and **the front door drops signed names when the LLM router is live**
(CPO #2). Both are engine-behavior gaps with clear, bounded fixes; neither
requires new surface area.
