# Quire — Experience Direction (2026-07-19)

**Session:** CPO (verdict) + CTO (feasibility), working from the experience dossier
(`docs/research/2026-07-19-experience-research.md`), PRD v1.0, the live app
(`/app/quire-brain`, `quire/static/app.html`), and the founder's standing rule:
meaning before mechanics — ids are footnotes, statements are the beef, receipts on demand.

---

## 1. The experience: **The Working Edition**

Quire is not a dashboard and not a doc viewer. It is **the org's book, mid-binding** —
a working edition being collated in front of you. The screen behaves like a dark
cockpit printed on paper: silent where the org is sound, lit where a promise broke,
redlined where the machine proposes, stamped where a human signed. Everything the
founder touches is one of three moods: **observed** (receipts), **proposed** (redlines,
"in quires"), **signed** (stamps). That trinity, worn on every surface, is the new
experience — not a feature, a physics.

### The walkthrough (performable cold)

**Arriving.** The rail is a wall of calm names — no green checkmarks anywhere. One
entity, *Feature*, carries a small amber mark. A single strip above the rail reads
"1 promise broken · 2 wait for you." The silence of everything else *is* the good
news, and the founder's eye goes to the one lit thing without being told.

**Reading the map.** The index isn't cards of counts; it's an annunciator panel.
Healthy entities are quiet ink. The amber one shows a single declarative line under
its name: *"Promises structured candidate lists. Stopped keeping it at check #7."*

**Focusing a node.** Clicking *Feature* opens its **record** — fixed geography, always
the same anatomy: identity sentence, then promises, then where it lives, then
relations, then a **colophon** footer ("Assembled from 3 signed decisions · latest
GD-2, 2026-07-18, cpo"). The broken promise leads with a sentence, not a status:
*"Feature promises structured candidate lists. `src/mcp/attention-formatter.ts`
stopped returning them at check #7 (commit 474c2e0)."* Kept promises sit in quiet
ink, badge-less.

**Following one fact to its source.** He clicks the verdict. A pane **stacks to the
right** — the check's receipt: a narrow monospace slip with commit, analyzer version,
observed values, verdict. He clicks the promise's source; a third pane stacks — the
verbatim PRD quote. A fourth: the signed decision that put the promise on this
entity. Four panes, side by side, spines at the left — the whole chain of custody
without leaving the page. The address bar now holds the trail; he pastes it into
Slack and the argument is over.

**Meeting a suggestion in place.** Back on the record, the machine's pending proposal
isn't in a queue — it's **in the body**, legal-redline style: struck old wording,
underlined new wording, a margin card with the clerk's rationale (*what I observed /
which promise it touches / what this resolves*) and Approve · Edit first · Reject.
He stamps it: "SIGNED · 2026-07-19" settles onto the fact with the product's one
physical animation. The rail's amber mark goes out a beat later.

**Teaching a word.** He asks the box for "billing." The map refuses to guess:
*"Nothing here answers to 'billing.' Nearest by wording: Payments."* Two chips: it's
another name / it's a new thing. He teaches the alias; the word is now signed
vocabulary, forever.

**Asking, and keeping the answer.** He asks "what did we promise about retries?"
The answer is not chat — it **materializes a gathering**: a scoped page of the two
entities, three promises, one receipt that constitute the answer, every fact carrying
its provenance chip. "Save this gathering" gives it a permalink for the board deck.

**Scrubbing time.** On the record, a thin scrubber with tick-marks at signed decisions
and verdict flips. He drags left; the record re-renders as of June 1 — which promises
existed, which held, what the map believed then. "When did this start failing?"
becomes a gesture, not a query.

### The cut

**IN (v1, demo-able):**
1. **Quiet-Dark Annunciator** (3.1) — rail silence, master-caution strip, no green.
2. **Voice + Quire lexicon + colophon** (4.1/4.2, 1.6's label register) — see §2.
3. **Check Receipt + Signature Stamp** (3.3) — receipts at the evidence layer only.
4. **Sliding-Pane Evidence Trails** (2.1 + 2.2's fixed card grammar) — trail in URL.
5. **In-Place Suggesting Mode** (2.4 + 2.3's why-triple in the margin card).
6. **Ask → Materialized Gatherings** (2.6) — saveable, addressable answer slices.
7. **Time Scrub on the record** (2.7) — structure + verdicts as-of; ticks at decisions.
8. **Craft substrate** (3.2/3.4/3.5) — one accent reserved for signing, verdict glyphs
   identical at every zoom, deep-link everything. Not a feature; the finish.

**V2:** 1.1 full Wikidata rank + superseded wordings kept visible (needs a wording-
revision store — see addendum); 1.3 variants-in-situ (rides on 1.1); 2.5 Figma
before/after worlds (needed only for multi-entity restructures, which the inbox cap
makes rare); 1.4 Tana pivot tables (great second view, zero demo urgency); 1.7
Observable ripple choreography (needs live check events; polish, not proof); 1.5
authored-edge provenance gets the hover-card in v1 via idea 4's card grammar, full
"connected by" narration v2.

**REJECTED:** graph canvas (PRD rule 11, and the dossier's own evidence); infinite
whiteboard (someone's mess becomes everyone's map); playful delight (wrong register
for broken promises); health scores ("94% aligned" is confident and unfalsifiable);
chat-first ask (transcripts are where provenance dies); full-costume skeuomorphism
(one stamp, or it's a theme restaurant); 2.8 as a feature (stable geography is
adopted as a *law* of the record page, not built as a thing); "collate" as an
approve-all verb (the dossier suggests it; rule 8 bans approve-all and rule 8 is
right — collation names the batch, never a bulk verb).

---

## 2. The language

**Voice: a court reporter with a bookbinder's hands.** Declarative sentences that
carry their own evidence. Never a mascot, never a scold, never "insights."

**Tone rules**
1. Three verb moods, enforced: **observed / proposed / signed**. The machine only
   observes and proposes; only humans sign. Copy may never blur these.
2. Verdicts are sentences with subjects and dates, not labels. The fact does the
   talking; ids and hashes are footnotes set in the mono face.
3. Every lexicon term must be self-teaching in one glance — used next to its plain
   meaning on first appearance, defined in one authored sentence on hover.
4. Two or three craft terms deep is a language; ten is a costume.
5. Numerals, tabular figures, active voice. No exclamation marks, ever.

**Lexicon — IN:** **signature / signed** (a human sign-off; the bookbinding pun is
structurally exact — the mark that guarantees correct assembly); **collation** (the
machine's proposal batch and the public log of the map's changes); **in quires**
(proposed, not yet bound — the unratified state); **colophon** (the provenance footer
on every record); **gathering** (a saved slice of the map — an answer you can keep).
**OUT:** *leaf/recto/verso* (promise is already the org's word; recto/verso fails the
one-glance test), *foliation* (ids are footnotes, they don't need poetry), *deckle,
folio, sewing* and all other costume.

**Ten strings, final voice**
1. *Empty map:* "Nothing here answers to a name yet. The first collation is being prepared."
2. *Needs-you chip, quiet:* "Nothing needs you."
3. *Needs-you chip, lit:* "2 questions wait. Worst first."
4. *Verdict line:* "Feature promises structured candidate lists. `attention-formatter.ts` stopped returning them at check #7 (commit 474c2e0, May 12)."
5. *Ask placeholder:* "Ask for a name, a promise, or a doubt."
6. *Refusal:* "Nothing on the map answers to 'billing' — and it won't guess. Nearest by wording: Payments. If billing is real, propose it."
7. *Unsigned state:* "Proposed, not signed. Still in quires."
8. *Margin card (machine):* "I read PRD §4 and propose one promise here. It is not signed."
9. *Stamp:* "SIGNED · 2026-07-19 · D.K."
10. *Colophon:* "Assembled from 3 signed decisions · latest GD-2, 2026-07-18, cpo. Machines propose; humans sign."

---

## 3. PRD amendments (diff-style; not applied)

- **Rule 1 — AMEND.** "Deltas over totals" → **"Silence over totals."** The front door
  is the quiet-dark map, not a delta headline (founder's critique + map-first have
  superseded the deltas-first home). Standing counts stay banned; deltas move to the
  **Collation Log**, the authored weekly changelog of the map. Recoveries ("kept
  again") report there.
- **Rule 4 — AMEND.** Add: at map level, *kept renders as silence* (no glyph, no
  green); the four-glyph vocabulary appears on records, enumerations, and legends.
  Unexercised ≠ kept is unchanged and load-bearing.
- **Rule 5 — AMEND.** "Approve/reject verbs live only in the inbox" → "the decision
  endpoint is the sole mutation path; the full card, with its verbs, may render
  in place on the record (suggesting mode) and in the inbox — nowhere else."
  (The shipped app already renders verbs on the record; the law catches up with
  the correct behavior and re-states the real invariant.)
- **Rule 2 — AMEND.** Add: the chain must be *walkable* — each link opens a stacked
  pane, and the whole trail is a stable URL.
- **Rule 12 — AMEND.** The footer motto becomes the **colophon** (assembly provenance
  + motto). Add the voice law: observed / proposed / signed; the machine never asserts.
- **§4 Surfaces — REWRITE.** Home = *the map* (annunciator rail + master-caution
  strip + quiet index). Entity dossier = *the record* (fixed geography; colophon;
  in-place suggesting mode). Add *the trail* (stacked evidence panes, serialized
  URL). Ask = *gatherings* (materialized, saveable slices; refusal + teach paths
  unchanged). Add *Collation Log*. Superseded page unchanged.
- **§5 Not-building — ADD:** health scores, ambient animation, approve-all under any
  name including "collate all."

---

## 4. Engineering addendum (CTO)

Ground truth verified against the running server: entity endpoint already returns
`promises` (with `state`, `since_check`), `pending` per-entity diffs, `via` on every
holding; `graph_state()` is a pure fold over approved diffs; 24 analyses in the
store with `head_sha`, `analyzer_version`, per-obligation findings; obligations
carry `revision` + `source_reference/source_section` (but **not** the verbatim quote).

Per v1 idea — what the engine must add:

1. **Quiet-dark annunciator — trivial.** All data present (`rollup`, `awaiting`).
   Frontend restraint + one derived "worst thing" sentence (reuse ask's status route).
2. **Voice/lexicon/colophon — trivial.** Copy pass; colophon assembles from `via` +
   diff decisions already served. No engine change.
3. **Check receipts — day.** New `GET /api/checks/{ws}/{n}`: resolve check number →
   analysis (the `since_check` ↔ analysis mapping must be made explicit — today it
   leans on PR number; persist a per-workspace check sequence). Receipt = analysis_id,
   head_sha, analyzer_version, per-obligation findings, timestamp — all stored.
4. **Evidence trails — day, one flag.** New `GET /api/fact/{ws}/{ref}` returning the
   fixed card grammar {quoted, signed, checked} + `GET /proposals/{diff_id}`
   (decided diffs are in `diffs.yaml`, just not individually addressable). **Flag:**
   obligations lack verbatim source quotes; rule 3 (no quote, no render) means we
   must snapshot the quote text per promise (from sources.yaml at onboard) — half a
   day, do it in slice 2 or trails render refusals. Trail URL serialization is frontend.
5. **In-place suggesting mode — day.** Per-entity pending diffs already served; add
   render hints per operation (which existing ref an op replaces, for strikethrough).
   Decision endpoint unchanged — **one-mutation-path holds**; this needs the Rule 5
   amendment, not engine change. Why-triple: observed/contradicts fields exist in
   findings; "what resolves" is authored from the proposal note in v1 (LLM field v2).
6. **Gatherings — day.** Ask already returns entity/status/red-flag structures; add a
   slice shape (entity+promise+check refs), `POST/GET /api/gatherings/{ws}`.
   **Invariant flag:** gatherings are annotations, stored *outside* `graph/diffs.yaml`
   — they must never be tier-1 edges or touch the fold.
7. **Time scrub — day.** `graph_state(diffs, as_of=...)` is a two-line filter on the
   fold (decision-instant ordering already exists). Verdicts-as-of: replay analyses
   with timestamp ≤ date. Tick-marks derive from decisions + verdict flips. **Scope:**
   structure + verdicts only; *wording*-as-of needs a revision history store —
   that's the Wikidata rank model, and it is **v2** (week: revisions table, rank
   field on promises, supersession display; our `revision` pin means history is
   replayable once we start persisting prior wordings — the model fits, the storage
   doesn't exist yet).
8. **Craft substrate — trivial/ongoing.** Glyph set + accent discipline are CSS; deep
   links fall out of slices 3–6.

No v1 item violates one-mutation-path or evidence-validation. Two watch-items:
gatherings stay non-authoritative (6); fact cards must refuse rather than render
quote-less (4, rule 3 enforced at the endpoint).

### Build order (each slice lands alone)

1. **The Hush** — quiet-dark rail + master caution + full copy/lexicon pass +
   colophon. Frontend only; the "not benign" delta is visible day one.
2. **Receipts** — check-sequence mapping + receipt endpoint + slip UI + quote
   snapshotting (unblocks rule 3 for everything downstream). Stamp polish.
3. **The Trail** — fact + decision endpoints, stacked panes, serialized trail URLs.
4. **Redlines** — in-place suggesting mode with margin why-card (uses the trail's
   card grammar).
5. **Gatherings** — ask materializes slices; save + permalink.
6. **The Scrub** — as-of fold + verdict replay + tick-marks. The demo crescendo.

*Doctrine, once: machines observe and propose; humans sign; the book stays open.*
