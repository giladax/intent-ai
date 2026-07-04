# UI Reimagining — Escaping the POC Bones; Altitude as the Core Interaction

> 2026-07-04 · concept phase · branch `feat/repo-brain` · **round 2, 2026-07-05**
> Mockups: [`mockups/01-sweep.html`](../../../mockups/01-sweep.html) · [`mockups/02-reach.html`](../../../mockups/02-reach.html) · [`mockups/03-grain.html`](../../../mockups/03-grain.html) (self-contained; open in any browser; screenshots in `mockups/shots/`)
> Owner's mandate, verbatim: *"beautiful, a bit gamified but still servable for top-down C-level review to engineer lens of a developer. All share same brain… I want animation and for it to step out of the box and understand the current UI was built on top of a POC UI, and we are still bound to its traits."*
> **Round 2 supersedes the round-1 execution** (the altitude *model* stands; the visual execution was rejected — see §4). The mockups and `mockups/shots/` now show the round-2 hierarchy.

---

## 1. The diagnosis nobody asked for first: the "current" and "Ask the Brain" buttons

Reproduced on the live built artifact (`web --port 3462`, Playwright, fresh `npm run build`).

**The prior pixel fix (`c0fb262`) shipped and holds.** Measured: masthead is a single
48px folio line, all seven controls visible and clickable (`.ink-intake` at x=1025,
`.ink-ask` at x=1124, no wrap); the dock opens `position: absolute` *under* the masthead
at y=48; the toggle stays hit-testable while open (`elementFromPoint` returns `.ink-ask`);
open → close cycles cleanly; zero page errors. **The pixels are innocent. The concept is
guilty.** What the owner still feels as "an issue" is three conceptual defects that no
z-index can fix:

1. **"current" is a status wearing a button's clothes.** It reads as a state readout
   ("the journal is current") but *clicking* it warps you to a hidden fifth page —
   Digest — that exists nowhere in the masthead's section model. No section lights up;
   you are somewhere the navigation says doesn't exist. And when the journal *is*
   current, the destination is a dead-end settings sheet whose first sentence is that
   you didn't need to come. Status, navigation, and configuration fused into one
   unlabeled chip. *(Screenshot evidence: clicking it lands on "Digest — the intake",
   with no active masthead section.)*
2. **"Ask the Brain" summons a fighter, not an inhabitant.** The Correspondence slides
   in as a 430px panel that covers roughly half the reading column at 1440px — the page
   you were reading does not reflow, it gets occluded. The panel opens *empty*, with
   meta-instructions for a hover-"talk" mechanic you haven't discovered. The button's
   label flips to "Close" (one control, two meanings). The chat is bolted *onto* the
   surface; the PRD says a conversation is *events in the river* ("a human comment is
   just another event"). The dock contradicts the product's own data model.
3. **Both buttons are refugees from the missing part of the model.** "Where does system
   state live?" and "where does conversation live?" had no answer in a masthead-over-
   list-pages shell, so both were exiled to chrome. They are symptoms; the shell is the
   disease.

**Resolution in the new model** (§3): digestion status becomes the **now edge** — the
top of the river itself, where "one session is still being written" appears as a ghost
entry at the place in *time* where it actually is; the press schedule is a note pinned
there. Ask-the-Brain becomes the **margin** — a permanently visible composer on the
surface's bottom edge whose answers *pin into the river as events*, citation-threaded
to their evidence. Both buttons disappear because both questions get real homes.

---

## 2. The POC traits that bind us (named, so we can refuse them)

The three passes today (purge → lens-affordances → color/motion) each made the POC
*better* — the ink palette is genuinely good, the quality marks are honest — but none
questioned its skeleton. The skeleton's traits:

| # | POC trait | What it costs |
|---|---|---|
| T1 | **Page-list navigation.** Four peer pages (Journal / Features / Review / Sessions) behind masthead tabs. | The one brain is served as four disjoint tables. Sessions and Journal are *the same events* twice. Review is a queue page for things that happened *in* the river. |
| T2 | **Time as list order, not space.** The river is a scrolling list with date headers. | No density, no rhythm, no distance. A violent week and a dead month occupy the same pixels. The C-level question — "is this org moving?" — has no visual answer, only captions. |
| T3 | **Lenses as pages, not altitude.** A Feature is a detail page you navigate *away* to. | "Features are lenses over the river" (PRD Principle 2) is asserted in copy and contradicted by structure: you can look at the lens or at the river, never *through* one at the other. |
| T4 | **Drill-down as navigation, not zoom.** Row → detail page → back button. | The evidence chain (understanding ← observation ← session ← moment ← transcript) exists but must be *hiked*, one page-load per hop. Provenance — the product's whole differentiator — is never visible as one object. |
| T5 | **Chat as overlay.** The Correspondence docks over the page. | Conversation fights the layout instead of joining the record. Answers evaporate; the PRD says they're events. |
| T6 | **Status as chrome.** "current", counts, badges in the masthead. | System state floats above the surface instead of being legible *in* it. Hence the broken chip. |
| T7 | **One fixed measure.** A 42rem column at every screen size, every task. | The C-level sweep and the engineer's grain are forced through the same keyhole. At 1440px, two-thirds of the paper is blank margin — and then the chat has to *cover* the text because there's "no room." |

---

## 3. The new model — one surface, three altitudes

**The Brain's surface is a single continuous timescape.** Time is rendered as space
(vertical, newest at top). Everything everyone does — CEO or engineer — is one of two
gestures: **travel** (move through time) or **altitude** (change how much time one
screen holds). Nobody navigates *between pages*; everybody moves *over the same river*.
That is what "all share same brain" looks like structurally.

### The permanent frame (identical at every altitude)

```
┌──────────────────────────────────────────────────────────────────┐
│ MASTHEAD   wordmark · search (the front door) · ALTIMETER · gate │
├──────┬─────────────────────────────────────────────┬─────────────┤
│      │                                             │             │
│ THE  │              THE SURFACE                    │  THE RAIL   │
│SPINE │   (the river, rendered at the current       │ (altitude-  │
│      │    altitude; scroll = travel through time)  │  dependent) │
│      │                                             │             │
├──────┴─────────────────────────────────────────────┴─────────────┤
│ THE MARGIN   ✒ ask the Brain — answers pin into the river        │
└──────────────────────────────────────────────────────────────────┘
```

- **The spine** (left, ~88px, always present): the *entire history* of the org as an
  ink-density column — every day a tick whose weight is its event count, today in moss.
  A **lens rectangle** on the spine shows exactly which slice of time the surface
  currently displays and at what altitude (the whole quarter → a week → a sliver of one
  night). Click anywhere on the spine to travel; drag the lens to resize = change
  altitude. The spine is the generalization of the fortnight strip (designer pass §1) —
  the one element that makes "where am I in time?" always answerable. It kills T2.
- **The altimeter** (masthead, replaces the four section tabs): three named stops.
  Changing altitude re-renders *the same span of river* at a different semantic
  resolution — it is zoom, not tab-switch. Keyboard: `[` ascend, `]` descend; scroll
  with `⌥` steps altitude; clicking any object descends *into* it (anchored zoom).
- **The margin** (bottom, always present): one italic input line. See §7.
- **The gate badge** (masthead, red): count of observations awaiting ink; clicking it
  travels to the *nearest pending gate on the river* — not to a queue page.

### Altitude I — SWEEP · "the quarter, at arm's length" (C-level)

*Mockup: `01-sweep.html`.* One screen holds 4–12 weeks. Weeks are **bands**: a kicker
rule, an **earned headline** (one serif sentence derived from that week's narratives —
the loudest thing that actually happened), a byline of actors, and a **skyline** — seven
day-columns of stacked ink bars, colored by the six-ink semantic system (red = struggle,
moss = verification, gold = discovery, violet = pivots, teal = decisions, consult = the
Brain used). Red-ink margin notes carry the editor's voice ("struggle ran hot Friday
night — red is information, not decoration").

The **rail at SWEEP is the strands**: all Features as compact cards — momentum
(`↗ rising · 41 → 118 ev`, real trailing-fortnight windows from `/api/stats/overview`),
a drawn spark-strand, and one **alignment line** (`aligned with intent · jul 4` /
`intent unmet — MVP owed` / `silence is information`). This is the five-second C-level
read: is the org working, where is it warm, is what we built still what we wanted.

The **now edge** sits at the top of the river: press status, ghost entries for sessions
still being written, streak. (Resolves the "current" chip, T6.)

### Altitude II — REACH · "the day, within reach" (lead / PM / daily driver)

*Mockup: `02-reach.html`.* One screen holds 1–7 days. Days are **chapters**; events are
**episodes on a thread** — sessions with their narrative gist and moment-count pips,
consults (hits and misses), Brain mutations, and **gates inline**: an observation
awaiting review renders *on the river where it happened*, stamps attached
(✓ Approve / ✕ Reject / ✎ Edit first). Review stops being a place you go; it is ink you
apply where you already are. (Kills the Review page; T1.)

The **lens deck** lives at the top of the surface: six chips, one per Feature. Applying
a lens does two things: (a) the river **tints** — evidence in the lens keeps full ink,
everything else recedes to ~38% opacity *but never disappears* (hover restores it;
context is sacred); (b) the **rail becomes the dossier** — the Feature's current
understanding, its constraints *each with a "from ⟨session⟩" source line*, known
unknowns in red ink, and its warm files. Understanding sits **beside** its evidence,
not instead of it. (Kills Features-as-pages; T3.)

### Altitude III — GRAIN · "the hour, in evidence" (engineer)

*Mockup: `03-grain.html`.* One screen holds one sitting, read closely. Moments in the
six inks with agency and anchor status (`◉ anchored — event 3c91aa · view raw`). The
**rail is the fidelity panel** — the anchored-% ring, supported/contradicted counts,
the chunk map — the delight-pass quality marks, kept whole.

The centerpiece is the **provenance trail**: any claim the Brain serves can be *pulled*
— one continuous drawn thread from **served constraint** ↑ **approved observation**
(with its stamp and stamper) ↑ **moment** (with quote) ↑ **raw transcript line**
(mono, highlighted, with its event id and `.intent/raw-sessions/` path). Four hops, one
object, animated as a single stroke drawing downward. This is "evidence over assertion"
*as a picture* — the thing an engineer screenshots to win an argument, and the thing a
C-level sees once and finally understands what the product is. (Kills T4.)

### What each old page becomes

| Today | In the new model |
|---|---|
| Journal page | The surface itself (REACH is roughly today's journal, re-rendered) |
| Sessions page | SWEEP skylines → REACH episodes; the archive joins the spine's oldest reaches |
| Features page | The lens deck + the dossier rail; the strands at SWEEP |
| Review page | Gates inline on the river + the masthead gate badge |
| Digest panel | The now edge (+ its `schedule` affordance opens the press settings in place) |
| Correspondence dock | The margin + correspondence cards pinned in the river |

---

## 4. Visual hierarchy — round 2 · "b2b saas, top level first" (supersedes the round-1 execution)

Owner's round-1 verdict, verbatim: *"Its still a bit nerdy and a bit hard to find the
meat. its flat with a lot of words. its overwhelming. this is b2b saas, top level
first."* The critique lands on the execution, not the model: round 1 set everything —
signals, evidence, chrome — in prose at nearly the same weight. The altitude model
survives untouched; round 2 replaces the typography-only execution with these rules:

1. **Hero-first: the answer before the evidence.** Every altitude opens with its
   numbers. SWEEP leads with a hero band of four instantly-legible signals — momentum
   (`418 ↗ +64%`), alignment (`4/6` aligned, `2 owed intent`), needs-you (`2`, red,
   breathing), evidence anchored (`68% ↗ +9pts`) — each with a trend delta. REACH and
   GRAIN open with stat-chip bars (`418 events · 4 sittings · 62% anchored · 2 gates`).
   A C-level answers "healthy or not / what moved / what needs me" in five seconds
   without reading a sentence.
2. **One hero number beats ten labels.** The type scale is steep and unambiguous:
   2.7rem tabular numerals over 0.56rem mono kickers. If two things share a size, they
   share an importance. Round 1's single-weight walls of serif are gone.
3. **Cards, not reading columns.** Anything meant to be scanned is a card in a grid
   with breathing room: the SWEEP feature grid (3×2 — name, alignment badge, event
   count + delta, spark-strand, one-line status), REACH episodes as cards on the
   thread, the GRAIN trail as a framed centerpiece. Reading columns exist only where
   reading is the task.
4. **Progressive disclosure — words earn their place.** Every round-1 sentence became
   a number, a mark, or moved behind `<details>`/hover: narrative gists, observation
   evidence, dossier understanding paragraphs, the Brain's answers. Cut ~80% of
   visible words at SWEEP; nothing deleted, everything deferred one click.
5. **Color is signal, never decoration.** The six-ink palette now marks *state* —
   alignment badges (moss = aligned, gold = intent owed, red = attention, faint =
   quiet), delta chips (moss up, red warn), the gate's red left edge — instead of
   tinting body text. Red appears only where something needs a human.
6. **"Needs you" is a place, not a search.** The SWEEP rail is a short actionable
   stack — observation gates with Approve/Reject stamps inline, stalls with a single
   link — never a feed. The masthead badge points at it.
7. **Density is altitude-dependent.** SWEEP is ruthless (the earned weekly headline is
   the only full sentence on the surface); REACH is scannable; GRAIN stays dense on
   purpose — but its focal spine, the numbered four-hop provenance trail, is
   unmistakable, and everything secondary folds.

What round 1 got right and round 2 keeps: the frame, the spine, the altimeter, the
inkwell, motion-as-meaning (§6), real-corpus-shaped data, `prefers-reduced-motion`
discipline. What it got wrong: flat weight, prose-as-interface, everything shown at
once.

## 5. Gamification — earned, never awarded

No points, no badges, no confetti. The game is *legibility of momentum*:

- **Warmth is earned.** A Feature's strand saturates with real event flow; the streak
  kindles gold only at ≥3 (delight-pass rule, kept). Quiet features fade toward faint —
  *"silence is information."*
- **Provenance is a trophy.** A fully-anchored trail (all four hops green) is the
  thing you want every claim to have; the anchored-% ring is the score that means
  something. Nothing celebrates; the thread simply *completes*.
- **The now edge breathes.** A 2.6s opacity pulse on the moss dot — the org's heartbeat,
  visible from across a conference room.
- **Headlines are won.** The week's headline is derived from its loudest narrative —
  shipping something big *changes the sentence the whole company reads*. That is the
  entire reward loop, and it's real.

## 6. Motion language — motion encodes meaning, or it doesn't move

| Motion | Meaning it encodes |
|---|---|
| **Anchored zoom** (altitude change): the pressed region scales up as siblings fall away; cross-document View Transitions (`@view-transition { navigation: auto }`, already in the mockups) in the MPA case, FLIP within the SPA | *Containment* — the day was inside the week; you went into it, not to it |
| **Thread draw** (provenance trail, citation threads, strand sparks): `stroke-dashoffset` / `scaleY` strokes, 1.2–1.6s, once | *Causality* — this came from that, drawn in the order it happened |
| **Skyline growth**: bars `scaleY` from the baseline, staggered ≤30ms | *Accumulation* — the day filled up |
| **Recede/restore** (lens tint): opacity+saturation, 250ms | *Attention, not deletion* — the rest of the world is still there |
| **Breathe** (now dot, gate dot): 2.6s ease-in-out opacity | *Liveness* — something is listening / something is waiting |
| **Rise** (entrances): 14px translate + fade, staggered, once | The page is *printed*, not painted |
| **Stamp thunk** (kept from today): 1px settle on `:active` | *Consequence* — approval is physical |

Rules: every animation runs **once** (only "breathe" loops, and it's the point);
everything settles ≤400ms except deliberate thread-draws; `prefers-reduced-motion`
silences all of it (mockups comply); no motion on data the user is trying to read.

## 7. Ask the Brain — a native inhabitant

- **The margin is always there.** One italic line at the surface's bottom edge:
  *"Ask the Brain anything — its answer pins into the river, with its evidence
  threaded…"*. No summoning, no dock, no button that flips to "Close." `⌘J` focuses it.
- **Scope is ambient and visible.** The composer carries what you're looking at as a
  scope chip (`lens: digest pipeline · jul 3–4` at REACH; `this sitting · moment #41`
  at GRAIN; whole-repo at SWEEP). The page *is* the context picker — today's hover-
  "talk" pin mechanic survives as "pin this element into scope," but the default scope
  is simply where you stand.
- **Answers are events.** An answer renders as a **correspondence card pinned into the
  river at now** — consult-blue rule, the question in italic, the answer in serif,
  **citations as threads**: each cite is a link that travels/zooms the surface to the
  cited event and draws the thread to it. Per PRD §Journal, the card *is* an
  `activity_event`; the conversation is part of the record, searchable, quotable,
  visible to the next person. Agents' consults render the same way — humans and agents
  legible in one correspondence.
- **History is the river.** "Where did my chat go?" is never a question; it went where
  everything goes.

## 8. What survives from today's three passes

- **The entire `--j-*` inkwell** — verbatim (the mockups copy it token-for-token),
  including the six-ink semantic mapping and light/dark variants. The palette is right;
  it was never the problem.
- **Newsreader serif + mono small-caps chrome**, ledger hairlines, red-ink margin
  notes, stamps — the editorial voice, promoted from page dressing to the language of
  a single instrument.
- **The quality affordances** (designer pass): fortnight strip → generalized into the
  spine; provenance rings + fidelity strip → the GRAIN rail; momentum marks → the
  strands. `/api/stats/overview` feeds all of it unchanged.
- **The motion inventory** (delight pass): rise, ring-arc draw, stamp thunk, streak
  kindle, reduced-motion discipline — extended, not replaced.
- **The Correspondence backend** (`/api/chat`, talk-kinds) — re-housed, not rewritten.

What does *not* survive: the four section tabs, the Review and Sessions pages as
destinations, the Digest page as a hidden fifth section, the chip-and-dock pair, and
the one-column-fits-all measure.

## 9. Phased implementation plan

**Phase 1 — resolve the buttons by giving their questions homes (ship this week; no
rewrite).** All inside the existing React shell:
1. **The now edge.** Move intake state from the masthead chip into the top of the
   Journal river: ghost entries for waiting/undigested sessions, press status line,
   streak. The chip dies; the Digest page's schedule controls open inline from the now
   edge. *(Touches `JournalPage.tsx`, `App.tsx`, `DigestPanel.tsx` relocation; the
   `/api/digest/schedule` + archive endpoints already exist.)*
2. **The margin.** Re-mount `ChatDock` as a one-line bottom composer on every view;
   answers post as pinned correspondence cards at the top of the river (persist as
   `comment:*` / `consult:*` events — the PRD already specifies this), each with cite
   chips linking to episodes. The Ask-the-Brain button dies with the dock.
3. **The spine, v0.** A read-only all-history density column on the Journal page
   (data: one grouped-by-day count query; the fortnight strip generalized). Click to
   scroll/jump. No lens-drag yet.
   
   *Exit criteria: both masthead buttons gone; nothing the old ones did is lost;
   Playwright pass on the three flows.*

**Phase 2 — altitude on one surface (folds Sessions in).** Semantic zoom with three
stops on the Journal: SWEEP (week bands + skylines + earned headlines — headline =
highest-moment-count narrative's summary sentence, no new LLM work needed), REACH
(today's journal, episodes + inline gates), GRAIN (today's session detail, mounted as
a zoom state instead of a route). Altimeter replaces the Journal/Sessions tabs. Anchored-
zoom transitions via FLIP. Review-in-river lands here (approve/reject inline; the
Review page becomes the gate badge).

**Phase 3 — lenses as light (folds Features in).** Lens deck + river tint + dossier
rail; the strands rail at SWEEP with momentum + alignment lines. FeatureDetail's
content becomes the dossier. The provenance trail component ships here (its data path —
`moment_evidence.source_event_id`, observation→feature links, raw archive — exists
end-to-end today).

**Phase 4 — polish to the mockups' bar.** Spine lens-drag, `⌥`-scroll altitude,
cross-view thread-draw on citation travel, dark-mode sweep, and the measurement-honest
alignment line per Feature once P2 intent evidence exists (until then the strands say
what's true: `intent unmet — MVP owed`).

Phases 2–4 each leave the app shippable; Phase 1 alone already resolves the owner's
reported issue *at the concept level*, not the pixel level.

---

## 10. Why this is the product

The PRD's four commitments — river as substrate, time as the only axis, Features as
lenses, evidence over assertion — are all *spatial* claims. The POC shell translated
each into a page, which is exactly the translation the PRD forbids ("no hierarchy as
navigation"). Altitude is the translation that keeps them: one substrate (one surface),
one axis (the spine), lenses that tint rather than contain (the deck), and provenance
you can physically pull (the trail). A CEO and the engineer she's talking to are on the
same surface, at different altitudes, looking at the same ink — which is the sentence
"all share same brain" turned into architecture.
