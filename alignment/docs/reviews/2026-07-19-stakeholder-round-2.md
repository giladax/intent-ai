# Stakeholder review — round 2 (2026-07-19)

**Under review:** commit `3cc7d95` ("stakeholder round 1 applied — 16 of 18
defects closed"), verified against the live product. Round 1 is
`docs/reviews/2026-07-19-stakeholder-round-1.md` (18 defects). Round 2 judges
the closures, the two deferrals' rationale, and regressions the fixes
introduced — nothing else.

**Method:** live server on :8359 against `quire-brain`; curl transcripts;
Playwright screenshots in
`/private/tmp/claude-501/-Users-giladkoch-dev-intent-ai/be3b52e6-798b-4c35-b281-2645489c7131/`
(r2-01-home, r2-02b-record-feature, r2-03-constellation, r2-04-ask-semantic,
r2-05c-ask-miss-resolved, r2-06b-receipt-slip). Test suite: **179 passed**
(commit claimed 176 — it has since grown; all green). Viewing story pages
lazily regenerated `workspaces/quire-brain/stories.yaml` — designed behavior;
no decision, teach, or code change was made by this review.

---

## CPO — NOT SATISFIED (one LOW residual; both HIGHs verified closed)

| R1 defect | Verdict | Evidence |
|---|---|---|
| 1 HIGH — lede falsehood / judge owed | **CLOSED** | `haiku_faithfulness_judge` (`story.py:301`) wired at generation time only (`api.py:693-699`); live org lede re-verified sentence-by-sentence against the facts: the "last two after edits" falsehood is gone; `unfaithful: 1` counted and surfaced in the byline ("1 sentence withheld"). GD-2..GD-5 all signed 2026-07-18 ✓; "nine of twelve housed" is the distinct-refs count (QUIREB-006 is shared) ✓. |
| 2 HIGH — signed names lose to the router | **CLOSED** | With the LLM live: `?q=current understanding` → `method: entity` → Current Understanding; `?q=Features` → Feature; `?q=understanding` → Current Understanding. Entity rung now precedes status routing (`api.py:386-405`). **No hijack regression:** "what broke", "what changed since yesterday", and even "is current understanding holding" still route `method: status` — exact name/alias match doesn't swallow status questions. |
| 3 MEDIUM — rule 4 in the constellation | **CLOSED** | `tone()` (`app.html`) returns `{c: rgba(28,26,21,.4), dash:[4,4]}` for all-unexercised stars; screenshot r2-03: Current Understanding wears a faint dashed ring, visibly not the calm ink of the kept; legend now carries "dashed ring — not yet exercised by any check". |
| 4 MEDIUM — rule-11 amendment unrecorded | **CLOSED** | `docs/PRD.md` rule 11 rewritten with "(Owner amendment, 2026-07-19)" — read-only constellation permitted, no verbs, never the front door; rules 1, 2, 5, 12 amendments present and dated. *Footnote, non-blocking:* `docs/2026-07-18-entity-experience-spec.md:77` still says "canvas (banned forever)" — a dated design doc; the PRD governs. |
| 5 LOW — refusals name internal ids | **HALF-CLOSED** → residual below | Scored misses now name nearest-by-meaning entities: "canonical response" refusal carries `near_by_meaning: [Feature .058, MCP Surface .052, Current Understanding .008]`, rendered as clickable names. But see R2-CPO-1. |

**Remaining defect:**

- **[R2-CPO-1, LOW] Zero-signal misses still render internal group ids.**
  Live: `?q=banana smoothie` → `method: unresolved`,
  `alternatives: ["G1","G2"]`, and the UI renders "Nearest by wording:
  G1, G2." (screenshot r2-05c-ask-miss-resolved.png). When the semantic rung
  scores 0 for everything, `near` is empty, and the `else` branch in
  `app.html` (miss render) falls back to raw `resolution.alternatives` —
  the exact rendering round 1 named. Fix is one line: map group ids to their
  area names (or show nothing when there is no meaning signal). The closure
  claim for R1-CPO-5 is half true; the primary sentence of that defect
  ("refusals name internal ids") is still reproducible.

**What holds:** the GD-1 refusal is now narrated correctly at both ends — the
lede reads "refused GD-1 — the proposal to name a grouping 'Brain' — on the
recorded reason of wrong name": the recorded reason is the verdict, the
proposal's question is quoted only as the thing refused. The declined atom's
phrasing (`atoms.py:66-71`) makes the conflation structurally hard, and the
judge carries the attribution law as backstop.

## CTO — SATISFIED (deferrals accepted; one re-pegged trigger; two notes)

| R1 defect | Verdict | Evidence |
|---|---|---|
| 1 MEDIUM — claimed ≠ built (parallel derivations) | **CLOSED** | `_decided_facts` deleted; `_org_facts` and `_entity_facts` both import and compose from `atoms_for` (`story.py:245,265`); the atoms module's claim is now true. The return arc flows through to the narrator (GD-10 atom → live lede sentence 4). `_health_facts` remains as a *state* projection over the same `build_timeline` the flip atoms walk — one derivation, two projections; acceptable. Entity facts are scoped atoms only; shared promises are marked "do not narrate that entity's other contents". |
| 2 MEDIUM — cache tracked, non-atomic | **CLOSED** | `alignment/.gitignore` ignores `workspaces/*/stories.yaml`; `git ls-files workspaces/quire-brain/` confirms untracked; `_write_cache` is mkstemp + `os.replace` (atomic). Judge runs only past the cache-hit early return — generation time only, verified in `get_story`. |
| 3 LOW — per-request recompute (deferred) | **DEFERRAL ACCEPTED, trigger re-pegged** | See below. |
| 4 LOW — threshold calibration (deferred) | **DEFERRAL ACCEPTED** | Trigger unchanged: a calibration set (must-resolve / must-refuse) is owed at the first wrong-entity resolution. None observed this round — the semantic hit resolved correctly, ambiguity refused with named neighbors. The whole-word receipt change is pinned in `tests/test_relevance.py`. Rationale lives in the commit message; adequate for a behavior-triggered deferral. |

**Deferral 3, judged against my own standard:** the deferral is sound in kind
(memo keyed on analysis count / event-time `state_after` persistence; the
`relevance.py` interface allows it without touching callers). But **the fixes
moved the number**: a *cached* story read now measures ~1.75s vs the ~0.90s
flat all-endpoint baseline (3 runs: 1.75/1.79/1.71 vs 0.96/0.88/0.87) — round
1 measured the story's own cost at ~0.01s over baseline. Composing facts from
atoms put ~2× `build_timeline` + `list_analyses` on the cache-hit path (facts
are rebuilt to compute the input hash before the cache can answer). At 24
analyses this is already the slowest read in the product. **Re-pegged
trigger:** the memo is owed at ~100–150 checks *or* when a cached story read
exceeds ~2.5s, whichever comes first — the round-1 "~300–500 checks" peg is
stale and must not be cited again.

**Notes (hygiene, non-blocking):**
- `workspaces/quire-brain/groups.yaml` carries an uncommitted live mutation
  in the working tree (`aliases: {who are you: QUIREB-002}`) — testing
  residue in tracked fold data, present before this review started. Commit it
  as a decision or revert it; tracked fold files must not drift silently.
- The fold remains write-clean: stories, atoms, and vectors are derived;
  mutation still flows only through the diff log.

## UX — NOT SATISFIED (one new MEDIUM regression; one LOW residual)

| R1 defect | Verdict | Evidence |
|---|---|---|
| 1 MEDIUM — tokenizer debris in receipts | **CLOSED** | Live semantic hit: "matched by meaning through: mcp, structured, tools" (r2-04-ask-semantic.png) — whole words; `resolve_semantic` intersects whole tokens only. |
| 2 MEDIUM — chip walls | **CLOSED** | Inline chips cap at 3 with `+N` expansion (`app.html` tellStory); the prompt now instructs ≤3 load-bearing refs per sentence; live lede sentences carry 3/3/1/1 chips — reads as margin notes. |
| 3 MEDIUM — chips don't land on receipts | **HALF-CLOSED** | Check chips now open an in-place receipt slip, not raw JSON — content verified: observed/commit/analyzer/verdict, findings with statements, relations, file:line citations, review signature (r2-06b-receipt-slip.png). But: (a) the slip is misplaced — see R2-UX-1; (b) diff chips still link to the whole inbox — see R2-UX-2. |
| 4 LOW — no acknowledgment, stale stacking | **CLOSED** | "reading the map…" pending state observed live (r2-05 series); `askSeq` guard drops superseded replies; replies replace, never stack. |
| 5 LOW — home rhythm | **CLOSED** | r2-01-home: lede → "Needs attention" banner → entity grid; the banner returns to its global slot on record/constellation views. |
| 6 LOW — constellation legend over-promises | **CLOSED** | Legend is built from what the sky holds: "solid thread" only when signed relations exist (none — absent ✓); "faint thread" present because the QUIREB-006 share is drawn (visible MCP Surface–Feature thread, r2-03). |

**Remaining defects:**

- **[R2-UX-1, MEDIUM — new, introduced by the fix] The receipt slip renders
  pinned to the top-LEFT, covering the sidebar nav.** DOM probe:
  `.slip` computed `position: fixed` at `x: 0` despite `right: 24px` in its
  rule. Root cause: the slip is created as `el("aside", "slip rise")`
  (`app.html:858,879`) and the *generic* sidebar rule
  `aside{position:fixed;inset:0 auto 0 0;width:252px;…}` (`app.html:24`)
  leaks `left: 0; bottom: 0` into it — `.slip` overrides top/right/width but
  never sets `left`/`bottom`, and `left:0 + width:340px` wins the
  over-constrained box. Every check-chip tap hides the primary nav
  (r2-06b-receipt-slip.png). One-line fix: `left:auto;bottom:auto` on
  `.slip`, or render a `div`.
- **[R2-UX-2, LOW — residual half of R1-UX-3] Diff chips still land on the
  whole inbox.** `citeLink` diff branch (`app.html:771-776`) hrefs
  `/inbox/{ws}` with no anchor; `inbox.html` has the `#decided` section
  (line 134) but no per-card anchor. The design line stands: "GD chips open
  the decided card."

**What holds:** the slip's *content* is exactly the right receipt — verdict,
findings with quoted statements, file:line, reviewer signature — and it
closes in place. The record still reads identity → story → quires → promises
(r2-02b); story prose pops in ~2s late on cold navigation (the CTO's
re-pegged perf item — same root), but "never a spinner where prose was"
holds.

## STORYTELLER — SATISFIED

- **The return arc is the lede's final movement** (R1 #1 closed): "That same
  day cpo refused GD-1 — the proposal to name a grouping 'Brain' — on the
  recorded reason of wrong name. The refused grouping returned the next day
  as GD-10, unsigned, recast under the name 'External System Boundaries'
  with a different shape." Refusal → teaching → return: the one plot the
  product owns, told on the page that exists to tell it. The "different
  shape" claim is atom-backed (`atoms.py:39-49`: same promise set, new
  name — rule-6 shape).
- **Inventory prose is out** (R1 #2 closed): the five-name proposal roll
  call is now "four unsigned groupings in quires await a signer"; the
  Feature record no longer narrates GD-3's cargo — it opens on its own
  wound with the check's actual finding ("check #7 found that candidate
  lists and ids are returned as prose an agent must parse") — mechanism
  named from evidence, not invented. The founding sentence ("placing 'MCP
  Surface', 'Current Understanding', 'Feature', and 'Write Provenance' on
  the map") is a borderline four-name list, but it carries a real plot
  point (the founding day) with one verb and true counts; I sign it.
- **The byline carries the why** (R1 #4 closed): "told 2026-07-19 · after
  GD-10 · 1 sentence withheld" — trigger, date, and the gate's count. A
  receipt, not a timestamp.
- **The casing stance** (R1 #3): the fix declined presentation-casing and
  codified the opposite — "Signers appear exactly as recorded (their
  signature is their name, whatever its case)" (the prompt's law). I asked
  for "the CPO"; the product answers that a signature is a recorded fact
  and prose must not retouch it. That is a defensible court-record
  principle, written down where the narrator lives. Dissent withdrawn.
- **Is the voice signable?** Yes. Wound first, stakes implicit, refusal
  correctly attributed, the return as the closing beat; no motive, no
  prediction, no flattery, no "I"; the unfaithful sentence was withheld and
  counted rather than published. I would sign both live stories in full —
  round 1, I would not sign either.

---

## Round-2 disposition

| Persona | Verdict | Remaining items |
|---|---|---|
| CPO | NOT SATISFIED | 1 LOW (R2-CPO-1: G1/G2 ids on zero-signal misses) |
| CTO | SATISFIED | deferrals accepted; memo trigger re-pegged (~100–150 checks or >2.5s read); groups.yaml hygiene note |
| UX | NOT SATISFIED | 1 MEDIUM (R2-UX-1: slip covers sidebar — new regression), 1 LOW (R2-UX-2: diff chips → whole inbox) |
| STORYTELLER | SATISFIED | — |

Of the claimed 16 closures, 14 verified fully closed, 2 verified
half-closed (R1-CPO-5, R1-UX-3); both deferrals stand on their stated
triggers (one re-pegged). One new regression was introduced by the fixes
(the slip's placement). No engine regression found: the ask ladder, the
judge gating, the atomic cache, and the fold's write-cleanliness all held
under live probing. The three remaining items are bounded UI fixes — one
CSS line, one id→name mapping, one anchor.

---

# Round 3 — final verdicts (2026-07-19)

Verification-only pass over commit `0ab70f3` (CPO/UX chair; CTO and
storyteller sign-offs carried from round 2). Live server on :8365,
headless-Chrome DOM probes + screenshots, curl probes, full suite.

- **R2-UX-1 — CLOSED.** The receipt slip pins top-RIGHT: computed
  `position:fixed; top:24px; right:24px` (`.slip{inset:24px 24px auto
  auto}`), measured rect left=1076/right=1416 at 1440px viewport; the rail
  spans left 0–252 — zero overlap (`overlapsRail:false`), confirmed
  visually in screenshot.
- **R2-UX-2 — CLOSED.** Diff citation chips carry the decision anchor
  (`/inbox/quire-brain#decided-GD-1`, likewise GD-2/3/5/6/10 on the org
  lede). Landing on `/inbox/quire-brain#decided-GD-1` scrolls the decided
  row to center (in-viewport, rect top≈580) and applies the brief wash
  highlight on the GD-1 "rejected · wrong name" row.
- **R2-CPO-1 — CLOSED.** `GET /api/ask/quire-brain?q=banana smoothie&llm=false`
  returns `alternatives_named: ["Write Governance", "Feature Serving"]` and
  a message naming labels ("Nearest areas: Write Governance (G1); Feature
  Serving (G2)"); the UI reads `resolution.alternatives_named` only
  (app.html:990) — labels or nothing, never bare ids.
- **Hygiene — CLOSED.** The stray "who are you" alias is gone from
  `workspaces/quire-brain/groups.yaml`; `git status` shows no workspace
  mutations under `alignment/` (only this review doc, untracked).
- **No regression.** `python3 -m pytest`: 179 passed, 0 failed (exit 0).

## Verdict

**ALL FOUR STAKEHOLDERS SATISFIED** — CPO ✓, CTO ✓ (carried), UX ✓,
storyteller ✓ (carried). The round-2 loop is closed.
