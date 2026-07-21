# Quire Align — Product Requirements (v1.0, 2026-07-18)

> Product source of truth for the alignment product. Supersedes
> `2026-07-17-experience-spec.md` and `2026-07-18-entity-experience-spec.md`
> (kept as history). Experience validated by the blind design round in
> `design/round1..2/` ("Meridian" mocks) with CPO iteration reviews;
> sign-off recorded 2026-07-18.

## 1. What this product is

An **organizational situation mirror**: it maintains the org's product as
durable semantic **Entities** (e.g. "Payments") that accumulate
heterogeneous evidence — approved **promises** (each with a verbatim quote
from the org's own artifacts and a health verdict), code locations, docs,
tickets, decisions, incidents, and automated PR **checks**. Its AI reasons
over evidence and proposes changes to this map as reviewable **graph
diffs**; humans approve, edit, or reject; only approved diffs mutate the
map, and the diff log is the map's immutable history.

The organizing question of every screen: **"what changed against what we
promised?"** — never "what happened?".

## 2. The graph

**Nodes.** Factual: source artifacts (content-hashed, authority-tagged),
code locations (path/symbol/role), checks (immutable, pinned to commit +
contract version + analyzer version). Semantic: promises (provenance-
quoted, revisioned) and entities (durable identity, aliases, lifecycle).

**Edges — three authority tiers.** (1) Human-asserted: approved diffs,
bindings, renames, aliases, must/cannot-links — never overridden.
(2) Mechanical/derived: provenance quotes (verbatim-validated), impact
edges with verified citations, similarity/co-mention/cluster evidence —
recomputable, never authoritative. (3) LLM-heuristic: names, borderline
adjudications, proposals — schema-caged, cached, always below tier 1.
Extension rule: any new signal (git co-change, Jira, Slack, sessions) is a
new edge type landing in exactly one tier with provenance; algorithms and
trust rules do not change.

**Events relate only through shared semantic entities.** No event-to-event
edge is ever stored; coherence for humans is derived at read time. Facts
are immutable; interpretation is versioned and appends — re-judgment
creates new events, never rewrites.

## 3. The Rules (design-validated, enshrined)

1. **Silence over totals.** *(Amended 2026-07-19, experience direction.)*
   The front door is the quiet-dark map: health shows by exception,
   kept renders as silence, and the org presents itself affirmatively.
   Standing counts stay banned as score-keeping; deltas — including
   recoveries ("kept again") — live in the Collation Log.
2. **Every rendered claim completes its chain:** statement → quoted source
   → enforcing file:line → latest verdict with date. *(Amended
   2026-07-19:)* the chain must be *walkable* — each link opens in
   place, and a trail is a stable URL.
3. **No quote, no render.** A result that can't quote its reason doesn't
   render; refusals name nearest-by-wording and offer a propose-it path.
4. **Never-checked is its own verdict.** "Unexercised" is never counted as
   kept; the glyph vocabulary is exactly ✖ contradicted · ◐ partial ·
   ✔ kept · **·** unexercised, with a legend on every surface using it.
5. **One mutation path.** Nothing mutates the map except an approved
   proposal. *(Amended 2026-07-19:)* the decision endpoint is the sole
   mutation path; the full card, with its verbs, may render in place on
   the record (suggesting mode) and in the inbox — nowhere else.
6. **Structured rejection.** Not-one-thing / wrong-name / bad-evidence /
   other-with-reason; a rejected proposal never returns in the same shape.
7. **Edited approvals are recorded human-amended.**
8. **The inbox orders by blast radius**, capped at ~5 open proposals; no
   approve-all, ever; one question per card, org quotes lead, mechanical
   scores are a footnote.
9. **Retired names forward.** They resolve to the successor with date,
   approver, proposal link, and "read it as it was."
10. **Supersession freezes, fully legibly.** The record stays; only the
    future moves. A supersession diff MUST enumerate the fate of every
    live promise on the predecessor — carried forward as a new promise
    with lineage, or explicitly retired. Silence is not an option; the
    proposal card shows this list. (Resolves the fold-vs-freeze
    contradiction found at sign-off.)
11. **No node-link canvas that edits or replaces the IA.** *(Owner
    amendment, 2026-07-19.)* Relationships remain role-labeled links
    traversed page-to-page; the map's home remains the index. A
    READ-ONLY spatial view (the constellation) is permitted as
    presentation and navigation — it may never carry verbs, never be
    the front door, and never store layout as meaning.
12. **Doctrine narrates once per page** — the colophon (assembly
    provenance + motto); the receipts do the talking. *(Amended
    2026-07-19:)* the voice law: the machine observes and proposes;
    only humans sign; copy may never blur the three moods. LLM-
    synthesized stories are bound by per-sentence citations validated
    mechanically (see the story-layer design, 2026-07-19).

## 4. The surfaces (per the signed-off Meridian mocks, design/round2/)

- **Home — the situation.** Headline sentence of deltas (bad AND
  recovered); "awaiting a human" (findings + proposals, review-only verbs,
  full cards live in the inbox); one coverage sentence; the map as an
  activity-ranked index with glyph legend.
- **Entity dossier.** Identity line (approved wording, diff-linked);
  health sentence readable aloud; the record (this entity's time-slice);
  ALL promises each with the full evidence chain (kept ones collapsed but
  expandable — affordance required); other holdings by kind; relations as
  a labeled list. Acceptance: home rollups and dossier marks always agree
  (unexercised ≠ kept).
- **Proposal inbox.** Blast-radius ordering with stakes labels that agree
  with position; card = one question + leading quotes + readable diff +
  Approve / Edit-first (visible preview) / structured reject.
- **Ask.** One box, three answer shapes (entity / cross-entity situation /
  semantic-with-quoted-reason), retired-name forwarding, designed refusal.
  Status questions never resolve to a single entity.
- **Superseded page.** Banner with successor/date/approver/diff; frozen,
  fully legible holdings; promise-fate list per rule 10.

## 5. MVP cut & build order

1. Graph-diff model + apply-on-approve engine + **inbox** (create/attach/
   supersede + structured reject). The graph is born through review.
2. **Entity dossier** (chains per rule 2; unexercised verdict per rule 4).
3. **Ask** with the three shapes (status route mandatory).
4. **Index/home** re-anchored on entities.
Seed: the LLM's first proposals consolidate the existing derived areas of
the live workspaces into entities — day one starts with real questions.

Not building: any canvas; entity split (post-MVP); mutation outside diffs;
more than docs+code ingestion in v1 (Slack decisions are the first
fast-follow and the source-agnosticism proof); notifications; permissions;
composite scores; trend charts.

## 6. Engine (already built and validated — unchanged by this PRD)

Deterministic verdicts over structured LLM findings; verbatim evidence
validation; authority ladder with abstention; contract snapshots and
idempotent checks; 8×99/99 eval stability; quality loop. The engine is the
evidence supply for the mirror; this PRD governs the map and the
experience above it.

## 7. Acceptance

The experience-EDD cases in `2026-07-18-entity-experience-spec.md` §Part 2
(14 graph-mutation cases) plus the sign-off defects as criteria: rollup/
dossier count agreement; expand affordance on collapsed promises; quoted
source on every non-kept promise; stakes label/position agreement;
promise-fate enumeration on supersession. Proof sentence: *a PM types
"payments", lands on a page assembled entirely from human-approved diffs,
and reads the org's situation aloud without composing anything.*
