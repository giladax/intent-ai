# Navigator board review — round 1 (2026-07-19)

**Under review:** commit dc053ba — `quire_align/model.py`, `GET /api/model/{ws}/around/{ref}`,
the `#/explore/<trail>` route in `quire_align/static/app.html`, `docs/2026-07-19-navigator-design.md`.

**The bar (pinned):** understanding you can cross-examine. Hero moment: a cold visitor clicks
from a bold claim down through the reasoning that connected it, to the check receipt, to the
exact file:line, seeing who signed what along the way. "A nicer Obsidian" fails by definition.

**Method:** live server on :8369 (workspace `quire-brain`), curl of
`/around/ent-feature`, `/around/QUIREB-006`, `/around/7`, `/around/GD-1`,
`/around/MCP Surface Violated Its Own Spec`; Playwright screenshots of every hop
(in `/private/tmp/claude-501/-Users-giladkoch-dev-intent-ai/be3b52e6-798b-4c35-b281-2645489c7131/`);
full read of `model.py`, the explore route, bindings/diffs/obligations YAML.
Baseline: `pytest` — 189 passed.

---

## Verdicts

| Persona | Verdict |
|---|---|
| CPO | **DEFECTS** — the hero chain's middle link (the reasoning) is empty for everything signed in the demo workspace, and a declined proposal wears the SIGNED badge. The walk exists; the cross-examination doesn't yet. |
| UX | **DEFECTS** — the check focus reproduces exactly the wall-of-small-italic-text the founder killed; the entity and mind focuses are genuinely good. |
| CTO | **DEFECTS** — one real custody bug (control-point description misattributed as the edge's why for every bound obligation), one mood-correctness bug (declined ⇒ signed), undisclosed filtering. Perf and route order are sound; zero LLM at view time confirmed. |
| STORYTELLER | **DEFECTS** — the voices land and the mind card's "kept verbatim" block is the best thing on screen, but the walk's spine narrates in ids and the signed layer has no thinking to read, so the account collapses into labeled rows precisely where the story should peak. |

No persona issues SHOWCASES-THE-IP this round.

---

## CPO — the cold hero walk

**What works.** The walk is real: `#/explore/ent-feature` → QUIREB-006 ("broken · since
check #7") → check #7 → `contradicts · src/mcp/server.ts:657` with a diff excerpt. Trail
chips accumulate in the URL and truncate back. Teach lives on the entity focus, dismiss on
the thought focus, and the open diff points at the inbox ("signing happens in the inbox →",
app.html:1027-1031) — the single mutation path is visible in the design, as promised.
Mood grouping (Signed / Observed / Thought) is present at every hop.

**Defect C1 (CRITICAL). The reasoning link of the hero chain is empty for the entire signed
layer.** Every diff in `workspaces/quire-brain/graph/diffs.yaml` lacks a `reasoning` key
(verified by loading the file: keys are `decision, diff_id, evidence, mechanics_note,
operations, proposed_at, proposed_by, question, shape_key, stakes, status`); the field was
added later (`entity_graph.py:154`, default `""`) and nothing backfills. Consequences,
verified by curl:
- `/around/ent-feature` → `"reasoning": ""` on the focus card; the "the thinking — kept
  verbatim" block (app.html:990-995) never renders for any signed node.
- Decision neighbors GD-2/GD-3/GD-6 all have `"why": ""` (model.py:182 passes
  `why=d.reasoning`).
- Attach notes are `""` throughout, so promise-holding rows have no why either.

The design's one claimed differentiator — "Edges carry reasoning… every connection renders
the reasoning that made it" (navigator-design.md §1) — is false of the only demo workspace.
A cold visitor's first click lands on a bold claim whose reasoning is blank. That is the
definition of "a nicer Obsidian." Until the signed layer carries thinking (backfill, or
degrade honestly — e.g. show the diff's evidence quotes as the why), the IP is asserted in
the doc and absent on screen.

**Defect C2 (MAJOR). A declined proposal wears the SIGNED badge.** `model.py:308`
(`"mood": "thought" if diff.status == "open" else "signed"`) and the same pattern on
neighbor rows (model.py:180-182, 251-254). `/around/GD-1` returns `"mood": "signed"` with
`"status": "rejected"`. Screenshot `e5-declined.png`: green `SIGNED` pill first, and only
the small mono meta line says "declined by cpo · 2026-07-18 · wrong name". A cold reader
sees rejected thinking presented in the ink of law. The moods do not partition: declined
needs its own mood (or at minimum the thought mood with a "declined" strike), never
`signed`.

**Defect C3 (MAJOR). Reasoning from a different promise is presented as this edge's why.**
See CTO T1 — under QUIREB-006 (structured content), the `src/mcp/server.ts` row reads
"why: … absence of write-to-source tools here enforces the no-edit constraint", which is
QUIREB-001's rationale. On the custody bar this is the worst kind of defect: not missing
reasoning, *wrong* reasoning, signed-section, cold-visible (screenshot `e2-promise-top.png`).

**Defect C4 (MODERATE). Asserted completeness the screen doesn't have.** The legend
(app.html:1054-1055) says "every row shows its why" while most signed rows show none (C1),
and the entity focus silently drops `unrelated` findings (model.py:187-192) and caps events
at the last 6 (model.py:200-202) with no on-screen disclosure. A cross-examinable surface
must not overclaim its own completeness. (Filter policy itself is defensible — see CTO T3.)

**Defect C5 (MODERATE). Search does not enter the navigator.** The ask ladder always routes
to `#/entity/…` (app.html:1172) or the ledger (app.html:1182-1190), even when you are
standing at `#/explore`. The design's "Entry: search-first" exists only as the record view's
"structure →" chip (app.html:434-437) — two hops from a cold search to the walk. The
founder's brief was literally "when I search payments I want to see the tree…".

**Defect C6 (MINOR). "Who signed" is missing at the promise hop.** Obligations carry no
signer or date (obligations.yaml keys: `kind, obligation_id, revision, source_reference,
source_section, statement`); the promise card shows "from prd MCP Surface" with no human
name anywhere. Signed-by is present on entities, decisions, and dismissals — the promise is
the one hop of the hero walk where "who signed what" goes silent.

**MCP contract check (design doc §3).** Sign/decline is truly absent from the tool table —
"**no tool.** Signing is human-only." (navigator-design.md:92) — and the write law
(attributed proposals only) is stated. `around()` returns exactly the `node / neighbors /
authority` package the view renders, so `quire_around` would give an agent the same
cross-examinable package. Two caveats: (a) none of it is implemented — the contract is
doc-only; (b) the `authority` block conflates human affordances (teach/dismiss/inbox) with
agent-permitted writes without saying which is which — the doc's write law should be in the
payload's own vocabulary before an agent client is built.

---

## UX — reading comfort, hop by hop

Screenshots (viewport 1280×850 unless noted):
`e1-entity-top.png`, `e1-entity-mid.png`, `e2-promise-top.png`, `e2-promise-mid.png`,
`e3-check-top.png`, `e3-check-mid.png`, `e3-check-deep.png`, `e4-mind.png`,
`e5-declined.png`, plus full-page `explore-*.png`.

**What works — say it plainly.** The entity focus (`e1-entity-top.png`) is the best screen
this product has shipped: badge pair, bold claim, italic identity, mono meta, then rows
with a 72px kind gutter — readable at arm's length, moods legible (dashed amber left border
on thought rows reads instantly). The mind focus (`e4-mind.png`) with the
"THE THINKING — KEPT VERBATIM" block is exactly what reasoning-first-class should look
like: bordered, labeled, normal-size upright type. An entity with ~16 neighbors (Feature)
scales fine *when the whys are short*.

**Defect U1 (MAJOR). The check focus is the wall the founder already killed.**
`_around_check` puts the full multi-paragraph analyst reasoning into `why` for **all**
impacts, untruncated (model.py:336 — contrast model.py:197's `[:200]` on the entity focus),
rendered as 13px italic muted text (`.xwhy`, app.html:122). `/around/7` yields twelve rows
averaging ~1,500 characters of italic prose each; the page is **5,141px tall**
(`e3-check-top.png`, `e3-check-mid.png`, `e3-check-deep.png` — three consecutive
screenfuls of unbroken small italic). This is, verbatim, the "walls of small italic text"
that killed the previous pass. The fix is the mind card's own pattern: first sentence
upright + expand-for-verbatim.

**Defect U2 (MAJOR). The row you walked in on is not marked.** Hopping
QUIREB-006 → check #7 lands you on twelve promise rows with no highlight on QUIREB-006's
finding — the cold visitor must re-find their own thread inside the wall of U1. The trail
knows the previous hop; the screen should use it.

**Defect U3 (MODERATE). Mid-sentence truncation with no ellipsis or expansion.**
model.py:197 (`impact.reasoning[:200]`): the check row on the entity and promise focuses
ends "…The API review finding F3 (which the PRD references) " (`e1-entity-mid.png`). Reads
as a rendering bug; there is no way to get the rest short of hopping.

**Defect U4 (MODERATE). Trail chips speak ids, not names.** "the walk:
`ent-feature → QUIREB-006 → 7`" — a chip that just says `7` is cryptic at arm's length,
and the pasteable walk (the design's rule-2 delivery) pastes as machine ids. Chips should
carry short human labels (Feature → structured-content promise → check #7); the hash can
keep the refs.

**Defect U5 (MINOR). The kind badge borrows the observed mood's class.** app.html:985 —
`el("span", "xbadge observed", n.kind)` styles every kind pill in observed-mood dress, so a
SIGNED card shows a second pill in the observed visual language (`e1-entity-top.png`). The
mood vocabulary must not be reused as a neutral gray.

**Defect U6 (MINOR). The receipt slip never appears in the navigator.** `receiptPane`
exists and is wired on the record view only (app.html:815); the check focus offers no
"open the receipt" and caps excerpts at 90 chars inside faint 10.5px mono meta
(model.py:339). The design (§1.4) claims "the receipt slip already gives one stacked pane"
— not on this route it doesn't.

**Defect U7 (TRIVIAL).** `if (trail.length > 1 || true)` (app.html:965) — dead condition.

---

## CTO — model.py correctness, perf, contract

**Confirmed sound.** Zero LLM at view time (no LLM imports anywhere in model.py; composes
from diffs YAML, graph fold, store analyses, atoms, mind cache). Route order safe:
`/api/model/{workspace:path}/around/{ref}` has a unique prefix and `ref` is a single
segment; the greedy `:path` cannot swallow `/around/`. Escaping discipline holds — all DOM
text goes through `el()`/`textContent` (app.html:210-215), and curl output containing
quotes/diff text rendered inert. 404 behavior correct (`nothing in the brain answers to…`,
api.py:742-743). 189 tests green before and after review (read-only).

**Defect T1 (MAJOR — correctness). Control-point description misattributed as the edge's
why.** model.py:242-250: for a promise focus, every binding row renders
`why=getattr(cp, "description", "")` — but a control point has **one** description written
from the perspective of whichever obligation motivated it. `CP-src-mcp-server-ts`'s
description is QUIREB-001's no-edit rationale (bindings.yaml:15-19), and `/around/QUIREB-006`
dutifully shows "absence of write-to-source tools here enforces the no-edit constraint" as
the why of *the structured-content promise's* enforcement edge. The why of an edge must
come from the binding (or be omitted), never from a neighbor object shared across edges.

**Defect T2 (MAJOR — correctness). `status != "open"` ⇒ mood `signed`.** model.py:308,
180-182, 251-254: declined diffs get the signed mood (evidence: `/around/GD-1` →
`"mood": "signed", "status": "rejected"`). The mood is the product's trust vocabulary; this
is a correctness bug, not styling.

**Defect T3 (MODERATE). The neighborhood filter is honest in policy, dishonest in
presentation.** Dropping `unrelated` findings from an entity's neighborhood (model.py:187-192)
is the right call — I curled `/around/7`: the unrelated findings are genuinely
looked-and-found-nothing analyses, and they remain complete on the check's own focus, so a
cross-examiner can reach them in one hop. But nothing on screen discloses the filter, the
`seen_checks` first-material-impact-only collapse (model.py:184-199 — a check that
materially hit *two* of the entity's promises shows only one why), or the `[-6:]` event
cap (model.py:200-202). One line under "Observed" — "material findings only; the check's
own page holds everything it looked at" — makes the filter part of the custody instead of
a hidden edit.

**Defect T4 (LOW). Ref-resolution shadowing.** Resolution order entity-id → promise-id →
GD-N → digits → mind-name (model.py:100-122) means a mind node named `7`, `GD-2`, or an
id-shaped string is unreachable, and duplicate mind names (case-insensitive `next()`,
model.py:118-121) silently resolve to the first. Improbable with current prose-y names
(`Check 7 Compliance Results` resolves fine — verified) but unguarded: nothing in
`mind.py` forbids id-shaped names. Same class: only the latest analysis per PR is
addressable (model.py:113-116) — check history exists in the store but has no ref.

**Defect T5 (LOW). Per-request recompute.** Every `around()` reloads diffs, refolds graph
state, rebuilds the full timeline (`_current_state` → `build_timeline` over all analyses),
and re-parses `mind.yaml`. Measured fine at 12 analyses / 10 diffs; it is O(analyses ×
obligations) per page view and will be felt at real scale. Note, not a blocker — flagging
so it's a chosen debt.

**Shared-brain contract:** implementable as specced. `quire_around(ref)` returning the
`around()` payload verbatim gives an agent exactly what the human sees — same node, same
neighbors, same whys, same authority block (modulo C7's authority-vocabulary caveat). The
table's HTTP column matches real routes (verified against api.py); `quire_receipt(n)` maps
to `/api/checks/{ws}/{n}` which exists (api.py:786). No MCP code exists yet; the tool list
is design-only, and sign/decline is correctly absent from it.

---

## STORYTELLER — the walk as an account

**What lands.** The section voices are doing real work: "Signed — the law of the map" /
"Observed — what checks saw" / "Thought — the mind, unsigned" tell a cold reader the
epistemology of each block before a single row is read. The event rows are the best prose
on the surface — "cpo signed GD-2, putting “Feature” on the map" and "QUIREB-006 went
broken at check #7" are chain-of-custody sentences, not database rows. "declined by cpo ·
wrong name" is a whole story in five words. The mind focus reads like a person thinking —
"That's not a minor slip; it means the MCP Surface… violated its own spec at the first
real exercise" — and the label "THE THINKING — KEPT VERBATIM" makes verbatim-ness itself
part of the product's promise. The footer "Machines propose; humans sign." is the thesis
stated where a colophon goes. This is not Obsidian's voice.

**Defect S1 (MAJOR). The story peaks where the page goes silent.** The account promised is
claim → *because* → receipt. On every signed node the *because* is blank (CPO C1), so the
narrative reads: "Feature. [no reasoning.] Signed by cpo." — a nameplate, not an argument.
The signed layer currently has the *authority* of law with none of the *opinion* of the
court. Until decisions carry their reasoning, the navigator tells *that* we decided, never
*why* — and "why" is the entire pitch.

**Defect S2 (MODERATE). The verbatim mind should be excerpted with expansion — in both
directions.** Where thinking exists it is either dumped whole (check focus, U1 — twelve
verbatim analyst essays no one will read in flow) or amputated mid-clause (entity focus,
U3). The right storytelling unit is the lede: one upright sentence of why in the row, the
verbatim kept behind an unfold labeled the same way the mind card labels it. Verbatim is
sacred as *evidence*; it is not the *narration*.

**Defect S3 (MODERATE). The walk narrates in ids.** "the walk: ent-feature → QUIREB-006 →
7" is the machine reciting its own keys (U4). The pasteable trail is supposed to be
quotable in an argument; nobody quotes `7`.

**Defect S4 (MINOR). One wrong word in the mood grammar.** An open governance proposal
(GD-6) files under "Thought — **the mind**, unsigned". A question waiting for a human
signature is not the mind musing; it is the docket. The unsigned mood is right; the
section's subtitle claims more than it should. And its declined sibling crossing the aisle
to "Signed" (C2/T2) breaks the grammar the three voices establish.

---

## Consolidated defects by severity

| # | Sev | Owner | Defect | Evidence |
|---|---|---|---|---|
| C1/S1 | CRITICAL | CPO/STORY | Signed layer has no reasoning anywhere in the demo workspace — hero chain's middle link empty | diffs.yaml key dump; curl `/around/ent-feature` `"reasoning": ""`; entity_graph.py:154 default; app.html:990 never fires |
| C2/T2 | MAJOR | CPO/CTO | Declined proposals get mood `signed` | model.py:308,180-182,251-254; curl `/around/GD-1`; `e5-declined.png` |
| C3/T1 | MAJOR | CPO/CTO | Control-point description rendered as edge-why for every bound obligation — wrong reasoning in the custody chain | model.py:242-250; bindings.yaml:15-19; `e2-promise-top.png` |
| U1 | MAJOR | UX | Check focus = walls of small italic text (the killed pattern); 5,141px page | model.py:336 untruncated; app.html:122; `e3-check-*.png` |
| U2 | MAJOR | UX | Arriving finding not highlighted on the check focus | walk QUIREB-006→7; `e3-check-top.png` |
| C4 | MODERATE | CPO | Legend overclaims ("every row shows its why"); filters/caps undisclosed | app.html:1054-1055; model.py:187-202 |
| C5 | MODERATE | CPO | Search never enters the navigator; entry is two hops away | app.html:1172,1182-1190,434-437 |
| T3 | MODERATE | CTO | Filter policy sound but invisible; first-material-impact collapse hides second findings | model.py:184-202; curl `/around/7` vs `/around/ent-feature` |
| U3/S2 | MODERATE | UX/STORY | 200-char mid-sentence truncation, no ellipsis/expansion; verbatim needs lede+unfold | model.py:197; `e1-entity-mid.png` |
| U4/S3 | MODERATE | UX/STORY | Trail chips speak ids not names | `e2-promise-top.png` trail bar |
| C6 | MINOR | CPO | No signer on the promise hop | obligations.yaml keys |
| U5 | MINOR | UX | Kind badge reuses `xbadge observed` mood class | app.html:985 |
| U6 | MINOR | UX | Receipt slip absent from navigator; excerpt capped at 90 chars in faint mono | app.html:815; model.py:339 |
| S4 | MINOR | STORY | Open proposals filed as "the mind" | `e1-entity-mid.png` GD-6 row |
| T4 | LOW | CTO | Ref shadowing (id-shaped mind names; only latest analysis per PR addressable) | model.py:100-122,113-116 |
| T5 | LOW | CTO | Full recompute (fold + timeline + atoms) per request — chosen debt, flag it | model.py:40-44,92-98 |
| U7 | TRIVIAL | UX | Dead `\|\| true` | app.html:965 |

**Round-1 direction (no invented scope):** C1 is the round-2 gate — the walk cannot
showcase reasoning-bound understanding while the signed layer's reasoning is empty.
C2/T1/U1 are the other blockers to the hero moment. Everything below MODERATE can ride
along. The entity and mind focuses prove the design can hit the bar; the defects are in
the data contract and the check hop, not the paradigm.

---

## Round 2 — final verdicts

**Under review:** commit 76d5b12 (round-1 fixes applied) atop the interleaved quality tick
5f8a72d. **Method:** live server on :8373 (workspace `quire-brain`); curl of
`/around/ent-feature`, `/around/GD-1`, `/around/QUIREB-006`, `/around/7`,
`/around/MCP%20Surface%20Violated%20Its%20Own%20Spec`, and a nonexistent ref; the full
walked hero chain and a cold-pasted trail via Playwright (screenshots `b2r-*.png` in the
be3b52e6 scratchpad); full read of `model.py` and the 76d5b12 diff; retired-thought lookup
exercised against a scratchpad copy of the workspace. Baseline: `pytest` — **194 passed**,
before and after (read-only review).

**All four personas: SHOWCASES-THE-IP. The loop is CLOSED.**

**CPO — SHOWCASES-THE-IP.** The hero chain now holds end to end, verified cold: `Feature`
(SIGNED, "signed by cpo · 2026-07-18") opens on a bold claim over a bordered "PROPOSED ON
THIS EVIDENCE" block carrying the creating diff's three quotes with sources — the middle
link speaks (C1 closed, honestly: evidence shown as evidence, no invented thoughts). Every
decision neighbor's why is non-empty via `_diff_why` (GD-2/GD-3/GD-6 all carry "proposed on
this evidence: …"). One hop lands on QUIREB-006 ("broken · since check #7") whose housing
names its signers ("holds it · signed by cpo · 2026-07-18", C6 closed) and whose enforcement
rows are custody-honest: the solo control point carries its own rationale, the shared ones
say "control point shared by 10 promises" instead of borrowing another promise's why (C3
closed). One more hop: check #7, `contradicts · src/mcp/server.ts:657 · "return
mcpText(fullText);"` — claim → reasoning → receipt → exact file:line, signers visible
throughout. `/around/GD-1` returns `mood: declined` and the screen shows a struck DECLINED
badge with "declined by cpo · wrong name" (C2 closed); GD-6 files under "In quires —
proposed, unsigned." The legend no longer overclaims and the entity focus discloses the
merely-looked filter (C4 closed); a semantic ask now offers "walk the structure →" which
lands directly on `#/explore/ent-feature` (C5 closed — exact-name asks still route via the
record view, where "structure →" is one visible click; accepted). Residual, non-blocking:
promise-name trail chips slice at 34 chars mid-word without an ellipsis.

**UX — SHOWCASES-THE-IP.** The check focus is no longer the wall: 2,273px total (was
5,141px), twelve rows each folded at a word boundary with an upright "more" that expands
in place — verified by clicking one (U1/U3 closed). Arriving at check #7 *from* QUIREB-006
lights and centers the QUIREB-006 finding (`.camefrom` present, scrollY 748 on arrival —
U2 closed, seen in `b2r-check-arrival.png`). Trail chips speak names as you walk —
"Feature → Candidate lists and ids returned b → check #7 — CONTRADICTS INTENT" (U4
substantially closed). The kind badge wears its own neutral `kindbadge` class beside the
mood pill (U5 closed), "open the receipt" on the check focus opens the CHECK #7 — RECEIPT
slip in place (U6 closed, click-verified), and the dead `|| true` is gone (U7 closed).
Two residuals, both minor and non-blocking: a cold-*pasted* trail shows raw ids for
ancestor chips (names are learned as you walk — the walker gets names, the paste recipient
gets ids with tooltips), and the 34-char chip slice cuts mid-word ("returned b") where the
whys got proper word-boundary care.

**CTO — SHOWCASES-THE-IP.** `_diff_mood` is a total three-way map (open/approved/rejected →
proposed/signed/declined) — declined can no longer wear ink (T2 closed); `_diff_why` returns
kept reasoning or degrades to the first evidence quote, never fabricates (C1 mechanics
sound); the solo-CP guard (`bound_count == 1`) attributes a control point's description only
when it binds one promise and otherwise discloses the sharing (T1 closed). The interleaved
quality commit 5f8a72d (fs.py extraction, api.py fallback-warning changes) broke nothing on
this surface: all five ref shapes resolve live (entity-id, promise-id, GD-N, digits,
mind-name → 200 with correct payloads), unknown refs 404 with the honest message, and zero
server errors across the whole review session; 194 tests green. The retired/dismissed-
thought branch has no demo data to exercise it — lookup logic verified against a scratchpad
copy; flagging the missing test as debt, not a defect. T4/T5 deferrals judged acceptable:
both were graded LOW in round 1 and explicitly non-blockers; the commit message records them
as chosen debt. One honesty note: the commit's "thresholds pegged" for T5 is not
substantiated anywhere in code or docs — the debt is flagged, the thresholds are not
actually pegged; carry it to the quality loop.

**STORYTELLER — SHOWCASES-THE-IP.** The walk now narrates. The chips read "Feature →
Candidate lists… → check #7 — CONTRADICTS INTENT" — a quotable sentence, not the machine
reciting keys (S3 closed for the walker). The custody blocks read as evidence, not apology:
"PROPOSED ON THIS EVIDENCE" presents the quotes that stood behind the signature in the same
bordered, labeled register as the mind's "THE THINKING — KEPT VERBATIM" — the signed
layer's *because* is audible on every decision row ("why: proposed on this evidence: 'The
served MCP surface must speak Feature only…' … more"), so the account finally runs claim →
because → receipt without going silent at its peak (S1 closed within what the data
honestly holds — quotes today, kept reasoning as new diffs carry it). The five moods
partition cleanly and the grammar holds: "In quires — proposed, unsigned" is the docket,
not the mind (S4 closed), and "Declined — refused, on the record" with a struck badge and
"declined by cpo · wrong name" is refusal kept as history, exactly this product's thesis.
The folded whys turn the check hop from twelve essays into twelve ledes with the verbatim
one unfold away (S2 closed). The colophon still says "Machines propose; humans sign," and
now the screens above it agree.

**The loop is CLOSED.** Residuals carried to the quality loop, none blocking the bar:
cold-pasted ancestor chips show ids; 34-char chip slice cuts mid-word; walk-chip appears
only on semantic ask replies; retired-thought branch untested; T5 thresholds asserted
pegged but not pegged anywhere.
