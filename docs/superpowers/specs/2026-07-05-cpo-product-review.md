# CPO Product Review — the Flow Verdict, the Chat-Alive Thesis, and the Shape of the Surface

> 2026-07-05 · product-shape review (no mockups, no code) · branch `feat/repo-brain`
> Reviewed: PRD v0.3.2 · CLAUDE.md Vision · strategic review 2026-07-04 ·
> `2026-07-04-ui-reimagining-design.md` (the altitude model, rounds 1–2) ·
> `mockups/` + `mockups/variant-b/` + `mockups/variant-c/` (all shots inspected) ·
> the live app (`src/web`, masthead/dock/pages as shipped) · the serving assets
> (re-digested corpus, 6 seeded Features with citation-gated understanding, provenance
> chain, `/api/chat` + TalkLayer pin mechanic, run-fidelity signals).
>
> Owner's verdict, verbatim: *"I didn't like the sweep reach intent, the ux flow is off,
> the product is no good for executives and not for devs or product in particular. chat
> should be also active and blend with what you see it should always be alive. cpo
> should review."*

---

## 0. Verdict in three sentences

The altitude model's **diagnosis (T1–T7) was right and stands; its cure is rejected** —
altitude-as-navigation serves no persona's actual job, and by mapping personas to zoom
stops it quietly rebuilt the tab problem it set out to kill. The owner's chat instinct
is not a feature request; it is **the product shape**: the Brain's material is
conversational evidence, and the surface should be a live correspondence with the org's
memory that composes views as exhibits and reacts to what's on screen. The recommended
shape — **the Correspondence and the Exhibit**, one surface, two co-equal panes — keeps
every PRD non-negotiable (river substrate, time axis, no trees, search as front door)
and has a one-week Phase 1 inside the existing React app.

---

## 1. Personas and jobs — who opens this product, and for what

The altitude spec designed for *readers of a timescape*. Nobody is a reader of a
timescape. These are the three people, and the questions they would actually open this
product to answer **this week, about this repo**:

### Dana — VP Engineering (exec). Weekly, five minutes, usually before a leadership meeting.

1. **"Did the team build what we decided?"** We decided digest fidelity gates the MVP
   measurement; the pipeline was rewritten and the corpus re-digested. Did the
   measurement run? What's blocking it? (Today's true answer: harness repaired, pilot
   run on Jul 4 — she should get *that sentence*, not a chart.)
2. **"Is the AI work trustworthy?"** 62–68% of served claims anchored to transcript
   lines — rising or falling? Can I defend this number upward?
3. **"What needs me?"** One decision waiting is fine; five is a problem; she needs the
   count and the single most consequential one.

Dana never wants the river. She wants three sentences with receipts *available on
demand* — the receipts are why she trusts the sentences, not what she reads.

### Maya — product lead. Daily-ish, ten minutes, owns the gates.

1. **"What happened while I was away?"** Per feature, since her last visit — not 418
   events, but "Digest Pipeline: re-audited and re-measured; Dashboard: three-variant
   mockup round rejected."
2. **"What did we decide that has no implementation?"** Intent unmet — the MVP
   measurement was owed for a week; which features are quietly diverging from what was
   agreed?
3. **"What awaits my ink?"** Pending observations, in context, with enough evidence
   attached to stamp them without a research project.

### Ori — engineer. Mid-task, often arriving through an agent or a deep link.

1. **"Why does this constraint exist?"** `brain_enter` just told his agent "confidence
   derives in code, not from the model" — says who, based on what session? He will not
   obey a rule he cannot trace.
2. **"What happened last night before I pick this up cold?"** The sittings, the
   struggle, where it ended — the actual narrative, dense is fine.
3. **"Is the digest of my session faithful?"** He was in the room; if the Brain
   misremembers his session he needs to see the fidelity marks and dispute it.

### Judged against those jobs

**The current app** (masthead: Journal / Features / Review / Sessions + "current" chip +
"Ask the Brain" dock; re-inspected on a fresh build at 1440×900 for this review) fails
all three, for reasons the altitude spec's own §1–§2 diagnosis measured correctly. Dana
has *no entry point at all* — the front page is a scrolling event list in a ~600px
column with the rest of the screen empty margin; her three sentences exist nowhere.
Maya's gates live in a Review page that, with nothing pending, is one italic line over
~700px of blank cream — and "what changed while I was away" means reading the river
manually; the Features list carries no health or fidelity signal at all, so strong
dossiers and thin ones look identical. Ori's provenance chain exists end-to-end in the
data — anchored `[s:…]` marks in understanding prose, per-session fidelity rings, a
record-level "68% anchored" — but the marks are raw hex, not obviously clickable, and
the chain must be hiked one page-load per hop. The chat opens *empty* except for
keyboard-grammar instructions, occludes rather than reflows (river titles visibly clip
mid-word behind the 430px sheet), and evaporates on close. Notably, the app's single
best surface today is Sessions — the one page with honest quality marks — and it's the
page none of the three personas' questions route through. The diagnosis (T1–T7) is
confirmed on the live build and is **retained in full** by this review.

**Variant A (editorial stat-cards, `mockups/shots/`).** The most legible B2B execution
of the three — hero numbers, feature grid, inline gates in REACH, and the GRAIN
provenance trail is genuinely the product's best picture of itself. But SWEEP's hero
band answers *how much*, never *whether*: "418 events ↗ +64%" is activity accounting.
Dana doesn't care that the org typed a lot; effort-volume is a vanity metric that
actively misleads (a violent struggle week scores *higher*). Her question — "did we
build what we decided?" — appears only as small alignment captions on feature cards.
Maya's "since I was away" doesn't exist at any altitude. Ori's trail is excellent but
lives three zoom gestures away from where he arrives.

**Variant B (dark mission-control).** Category error. The swimlane-per-feature REACH and
the area-chart SWEEP read as Datadog — an *ops monitoring* product, which frames the
org's development as a system to be monitored rather than a memory to be consulted. It
answers "is the system emitting events" — nobody's question. It is also the variant
most hostile to the editorial/evidence brand the PRD names ("journal, clippings,
stamps, red ink"). Gamified in the wrong direction: dashboards feel like watching,
not understanding.

**Variant C (editorial magazine).** Closest to Dana's five-second read — "**Aligned,
and moving.** … One decision waits for you" is *exactly* the right first sentence, and
its GRAIN dossier (the pulled quote, four hops, "the digest that survived") is the
single best screen in all nine mockups. But it's a poster, not a product: the REACH
"first of six features →" pagination is a slideshow — Maya cannot work a queue by
flipping through a magazine — and the composed prose ("Nine sessions this fortnight,
each one anchored to its evidence") has no visible interaction to interrogate it. It
tells; it doesn't answer back. And note what Variant C accidentally proves: **its best
screens are already utterances.** "Aligned, and moving" is something a brain *says*,
not a page you navigate to.

### Why altitude-as-navigation failed all three personas

1. **Altitude is a camera metaphor; jobs are question-shaped.** No persona's first move
   is "show me time at some magnification." Dana wants a verdict, Maya wants a delta,
   Ori wants a *why*. Zoom presumes everyone's job is reading the river at some
   resolution — but nobody's job is reading the river. The river is the *evidence*;
   the model made it the *interface*.
2. **The altimeter is the tab bar it replaced.** SWEEP/REACH/GRAIN are three named
   destinations with three different layouts, three different rails, and three implied
   audiences. That is T1 (page-list navigation) rotated 90°. Worse: mapping exec→SWEEP,
   PM→REACH, engineer→GRAIN *segregates* the audiences the owner explicitly wants on
   one shared brain — three products in a trenchcoat.
3. **It taxes every answer with travel.** The interaction grammar (travel, zoom,
   lens-drag, `⌥`-scroll) is a skill to acquire before the first question gets
   answered. B2B top-level-first means the answer is on screen *before* any gesture.
4. **All three variants demoted the one thing the owner promoted.** Chat became "the
   margin" — a one-line italic footer. Polite, dismissible, dead. The owner's verdict
   ("should always be alive… blend with what you see") is the precise negation of a
   footer. The model treated conversation as an inhabitant of the surface; the owner is
   telling us conversation *is* the surface.

The spec's §10 claimed "the PRD's four commitments are all spatial claims." They are
not. They are *epistemic* claims — about where understanding comes from and how it's
proven. The spatialization was the mistake.

---

## 2. The chat-alive thesis — taking the owner's instinct seriously

The instinct is right, and here is the product logic for why, not just deference:

**Everything this brain owns is language plus citations.** Digests, moments,
narratives, observations, constraints, current understanding — the entire inventory is
sentences that trace to evidence. There is no chart-native object anywhere in the
model. A product whose substance is *cited prose about what happened and why* has a
natural surface: **a conversation with the org's memory**, where views are artifacts
the conversation produces, and the conversation reacts to what's on screen. The PRD
already half-says this: search is the front door; answers are events; "the page is the
context picker"; understanding — not documents — is what Brain returns. A question *is*
a search. The Correspondence isn't a feature of the journal; the journal is the
memory of the Correspondence.

### What "always alive" means, mechanically

**Presence.** The Correspondence is a *co-equal pane*, permanently on screen — not a
dock, not an overlay, not a margin line. Two panes, one instrument: the Correspondence
(the brain speaking and listening) and the **Exhibit** (the evidence it shows you).
Neither ever occludes the other; the window resizes them together. There is no
"open the chat" — the product *is* open chat. `⌘J` focuses the composer; it never
summons anything.

**Context-binding, in both directions.**
- *What you see shapes the conversation:* everything in the Exhibit is selectable
  (the shipped `data-talk` / TalkLayer mechanic, generalized from "pin" to "select").
  Select a Feature and the Brain **speaks to it unprompted** — a three-line grounded
  brief: what it is now, what changed lately, what needs you — with citations. Select
  an event, a moment, a constraint: same. Selection is an utterance.
- *The conversation drives what you see:* every Brain answer returns **structured
  citations, and the Exhibit reorganizes to show them.** Ask "did we build what we
  decided on digest fidelity?" → the Exhibit becomes that Feature's dossier with the
  cited events highlighted on its stretch of river. Ask "why does this constraint
  exist?" → the Exhibit becomes the four-hop provenance trail (the altitude spec's best
  invention, kept whole). The view is the answer's exhibit — evidence over assertion
  *as layout*.

**Proactivity — the Brain speaks unprompted, on exactly three triggers.**
1. **Arrival.** The first message of every visit is the Brain's standing brief, scoped
   to who you are (below). Nobody ever faces an empty composer with meta-instructions.
2. **A gate needs you.** A pending observation surfaces *as a conversational ask* —
   evidence attached, Approve / Reject / Edit stamps inline in the message. Review
   stops being a place; it's something the Brain asks you.
3. **What you're viewing just changed.** A session digesting right now touches the
   Feature on your screen → one quiet line ("a sitting on this feature is being written
   — 12 moments so far"). The now-edge breathes *in the conversation*.

Bounded, or it's noise: the Brain never interrupts composing, batches triggers,
and says nothing when nothing happened — silence is information here too.

**Persistence — the conversation is river-native.** Per PRD §Journal, every utterance
is an `activity_event` (`comment:*`, `consult:*`): searchable, quotable, visible to the
next person, and **agents' MCP consults render in the same correspondence** —
mid-session, Ori can watch his own agent ask the Brain and see what it was told. One
correspondence, humans and agents legible together. "Where did my chat go" is never a
question.

**One brain, three openers.** Persona differentiation lives in the *first utterance and
default scope*, never in separate UIs:
- Dana arrives → the brief: *"Aligned and moving — 4 of 6 features hold to intent; the
  measurement pilot ran Thursday; 68% of served claims are anchored, up 9 points. One
  decision waits for you."* (Variant C's hero, delivered as speech, with citations.)
- Maya arrives → *"Since Tuesday: Digest Pipeline was re-audited and re-measured;
  the mockup round was rejected. Two observations await your ink — first one attached."*
- Ori arrives (often via deep link from code/agent) → *"You're in
  `src/pipeline/emit-events.ts` — governed by Activity Event Backbone. One constraint
  applies; last touched in Thursday's sitting, which ended mid-struggle. Trail?"*

Same brain, same memory, same pane — the difference is only what it says first.

### What chat-alive is *not*

- **Not chatbot-only UI.** Kill the Exhibit and trust dies with it — an exec believes
  the sentence because the receipts are visibly one selection away; an engineer
  believes nothing he can't trace. Prose alone is assertion; the pane pair is
  evidence over assertion.
- **Not autonomy.** Gates stay human (Principle 5); the stamps stay physical; the Brain
  asks, never decides.
- **Not a notification firehose.** Three triggers, batched, quiet by default.

### Honest risks

- **Groundedness.** Today's `/api/chat` is context-stuffing (pinned items / one
  feature's digests) with no retrieval. Alive-and-cited requires tool-use over
  `brain_search` + the provenance endpoints, and a cite-or-refuse rule. This is the
  real engineering cost of the thesis — name it now, not in sprint review.
- **Latency.** An arrival brief that takes eight seconds is a dead brain. The brief
  must be **pre-computed** (the repo's own pre-computation principle): deterministic
  assembly from `/api/stats/overview` + pending gates + last-visit delta, LLM-polished
  at digest time, not at page load.
- **Cost.** The strategic review already flagged Sonnet cost drift (risk 5). Briefs are
  computed per digest, not per visit; selection briefs are Haiku-sized; only free-form
  questions earn Sonnet.
- **Eval.** The strategic review's Q4 gap applies squarely: a conversational surface
  with zero search/answer measurement is unfalsifiable delight. The 10-query smoke set
  (already prescribed, already cheap) becomes a prerequisite of this direction, not a
  stretch goal.

---

## 3. The recommendation — the Correspondence and the Exhibit

**One direction, no options:**

> **The surface is a live correspondence with the organization's memory, standing
> beside an evidence exhibit it controls and responds to.** Two co-equal panes, one
> brain. The Correspondence is always present, speaks first, binds to what's selected,
> and writes itself into the river. The Exhibit renders whatever the conversation is
> about — and there are only four exhibits: **the River** (a stretch of time), **the
> Dossier** (a Feature's lens: understanding, constraints with sources, unknowns, warm
> files, its slice of river), **the Trail** (the four-hop provenance pull), and **the
> Brief** (the standing verdict: alignment, fidelity, needs-you). Every exhibit is a
> projection of the river; time is every exhibit's axis; the spine survives as the
> Exhibit's time scrubber. The composer is the front door: one input where searching
> and asking are the same act.

**Primary flow and five-second test, per persona:**

| Persona | Primary flow | Five-second test |
|---|---|---|
| Dana | Open → the Brain's brief is already the first message; the Exhibit shows the Brief. She reads three sentences; if one bothers her, she asks, and the Exhibit shows the receipts. | *Without a single click:* "Is the org moving on what we decided, and does anything need me?" — answered. |
| Maya | Open → since-you-were-away brief + first gate attached as a conversational ask; stamps inline. Select any feature → Dossier + the Brain speaks its state. | *Within one selection:* "What changed on my features, and what awaits my ink?" |
| Ori | Deep link from code, session, or his agent's `brain_enter` → the Trail exhibit for the claim in question; the Brain's opener names the constraint and its source sitting. | *On arrival:* "Where did this claim come from?" — the transcript line is on screen. |

**What survives from today's assets (most of them):**

- The **six-ink inkwell and editorial voice** — verbatim. It was never the problem.
- **ProvenancePanel / the provenance chain** — promoted to the Trail, the star exhibit
  and the product's proudest picture (Variant C's GRAIN is its target rendering).
- **Quality affordances** (anchored-% ring, fidelity strip, fortnight strip → spine as
  scrubber) — they are how the Exhibit earns trust.
- **`/api/chat` + SSE + TalkLayer** — the seed of the Correspondence; upgraded to
  retrieval tool-use, structured citations, and event persistence; never rewritten.
- **The stamps and the review event plumbing** — re-homed into conversational gate asks.
- **The masthead** — shrinks to wordmark + the one input + the gate badge.

**What dies:**

- The altimeter and SWEEP/REACH/GRAIN as navigation. (The *renderings* partially
  survive as exhibits: Variant C's hero → the Brief; Variant A's GRAIN trail → the
  Trail; feature cards → the Dossier's header.)
- The four section tabs; Review, Sessions, and Digest as destinations.
- The chat dock, the "Ask the Brain" button, the margin-footer composer, the
  "current" chip.
- Variant B's mission-control direction, entirely.

**Non-negotiables check:** river substrate — kept (exhibits are river projections;
utterances are river events). Time axis — kept (every exhibit is time-organized; the
spine scrubs it). No trees, no graph-viz — kept (navigation is conversation + search +
selection; there is no hierarchy anywhere). Search as front door — strengthened (the
composer *is* the search box). Human-gated mutations — kept (gates as asks, stamps
human). Beautiful/gamified/delight — the game remains earned legibility: the brief that
says "aligned, and moving" is the score; the completed four-hop trail is the trophy;
the breathing now-line in the conversation is the heartbeat.

---

## 4. Phase 1 — the smallest shippable slice (existing React app)

Scope discipline first: **this must not displace the MVP measurement path.** The
strategic review's verdict stands — the harness and the story-time arm are the critical
path. Phase 1 below is ~1 engineer-week of frontend + one endpoint change; it proceeds
*after* the pilot loop is running or on separate capacity, never instead of it. The
designer round (§5) can start immediately — it costs no engineering.

1. **The two-pane shell.** Re-mount ChatDock's innards as a persistent left pane
   (~38–42% width, resizable); Exhibit right, defaulting to the River (today's
   JournalPage). Kill the dock, the overlay behavior, the Ask-the-Brain button, and the
   section tabs' Journal/Review split (Features stays reachable via selection; Review
   dissolves into gate asks; Sessions page survives untouched behind a link for now).
   *~1.5 days.*
2. **The arrival brief, deterministic.** First message assembled in code from
   `/api/stats/overview` + pending observations + digest schedule + last-visit
   timestamp (localStorage). No LLM at page load. The "current" chip dies; its facts
   move into the brief. *~1 day.*
3. **Selection speaks.** Generalize TalkLayer: selecting any `data-talk` element posts
   a scope change; the Brain replies with a short brief via the existing
   `contextItems` path (Haiku). Scope chip on the composer shows the binding. *~1 day.*
4. **Answers exhibit.** `/api/chat` returns structured citation ids alongside prose
   (the pinned-context path already knows its sources); citations render as chips;
   clicking one scrolls/highlights the River or opens the Dossier (FeatureDetail
   re-used as an exhibit, not a page). *~1.5 days.*
5. **The conversation joins the river.** Persist question/answer as `comment:*` /
   `consult:*` events (PRD-specified); render correspondence cards in the River.
   *~1 day.*
6. **Playwright passes on the three persona flows** (Dana cold-open, Maya gate-stamp
   from conversation, Ori citation→trail via ProvenancePanel). *~1 day.*

**Honest total: ~7 working days.** Explicitly *out* of Phase 1: retrieval tool-use in
chat (Phase 2, and the biggest real cost of the thesis), proactive triggers 2–3
(gate-ask arrives in Phase 1 only as part of the brief; live-change whispers are Phase
2), exhibit transition animation, the Brief as a designed exhibit (Phase 1 renders it
as the arrival message only), Sessions-page retirement.

Phase 2 (post-measurement-pilot): chat tool-use over `brain_search` + provenance
endpoints with cite-or-refuse; the search smoke set as its eval; gate asks and
live-change whispers; the Brief and Trail as designed exhibits; Sessions folds in.

---

## 5. What to tell the designers

> Design one surface with two panes that never cover each other: on the left, a living
> correspondence with the organization's memory — it speaks first ("Aligned, and
> moving. One decision waits for you."), it speaks when you select something, it asks
> for approvals with stamps inline, and every answer carries citations; on the right,
> the exhibit the conversation controls — four renderings only (a stretch of river, a
> feature dossier, a four-hop provenance trail, a standing brief), all organized by
> time, with the history spine as scrubber. There is no altimeter, no tabs, no chat
> button: selecting evidence makes the brain speak, and asking a question reorganizes
> the exhibit to show the receipts — design that handshake as the hero moment in both
> directions. Keep the six-ink palette, the editorial voice, the stamps, and the
> earned-motion rules; take the hero sentence from variant C, the provenance trail from
> the GRAIN mockups, and the inline gate from variant B's popover — discard everything
> else about altitude. It must pass three five-second tests cold: an exec reads whether
> the org is moving on what was decided without clicking; a product lead sees what
> changed and what awaits her ink within one selection; an engineer landing from code
> sees the transcript line behind a constraint on arrival.

---

## Appendix — disposition of the rejected round

| Artifact | Disposition |
|---|---|
| T1–T7 POC diagnosis (ui-reimagining §1–2) | **Adopted.** Still the correct critique of the shipped app. |
| Altitude model (§3), altimeter, travel/zoom grammar | **Rejected** as navigation. |
| The spine | **Kept**, demoted to Exhibit time-scrubber. |
| Provenance trail (GRAIN centerpiece) | **Kept whole** — becomes the Trail exhibit. |
| Now edge | **Kept as speech** — the brief and live-change whispers, not a screen region. |
| The margin composer (§7) | **Superseded** — the Correspondence is a pane, not a footer; answers-as-events kept verbatim. |
| Round-2 B2B rules (hero-first, cards, progressive disclosure, color-as-signal) | **Kept** as Exhibit design rules. |
| Variant A | Source for stat-chip and trail rendering. |
| Variant B | Rejected direction; salvage the inline gate popover only. |
| Variant C | Source for the Brief's voice and the dossier typography. |
| ui-reimagining Phase 1 (now edge / margin / spine v0) | **Superseded by §4 above.** |

---

## Final round — the mockups exist (2026-07-05)

The §5 brief was executed as three interlinked standalone mockups in
[`mockups/final/`](../../../mockups/final/) (screenshots in `mockups/final/shots/`,
1440×900, Playwright):

- **`01-arrival.html`** — Dana's cold open. The Correspondence speaks first (the
  standing brief, with citations, plus the one gate asked inline with stamps); the
  Exhibit renders the Brief — hero sentence, four signals, the six-feature ledger
  against intent, and the fortnight stretch of river — all above the fold at 1440×900.
- **`02-selection.html`** — Maya mid-handshake, direction one. Digest Pipeline is
  selected in the Exhibit (Dossier: understanding with anchor marks, constraints with
  sources, unknowns, warm files, its slice of river); a **gold thread draws across the
  pane seam** from the selected header to the unprompted three-line brief it produced
  (*is now / changed / needs you*), labeled "selection is an utterance." Her gate
  waits inline with working approve/reject/edit stamps (the thunk answers back).
- **`03-receipts.html`** — Ori, direction two. His agent's `brain_enter` consult
  renders in the same correspondence; he asks "says who?"; the answer carries four
  hop-numbered citations and a **consult-blue thread to the Trail** the question
  composed — all four hops plus the raw transcript line (hop 4, open, gold-marked)
  on screen on arrival, seal below.

Execution decisions within the brief: (1) the composer lives at the foot of the
Correspondence pane rather than the masthead — a correspondence owns its own pen; the
masthead keeps only wordmark, now-whisper, and gate badge (plus discreet walkthrough
links, which are mockup chrome, not product navigation). (2) The handshake is drawn
literally: a once-drawn thread (1.3s, dash-offset, thread-draw rule) across the pane
seam in each direction — gold for selection→speech, consult for question→exhibit.
(3) The spine sits at the Exhibit's right edge as its scrubber, lens sized per page
(fortnight / fortnight / one sitting). (4) All motion follows the earned rules:
rise-once entrances, skyline growth ≤30ms stagger, breathe only on now/gate dots,
seal drawn not awarded, `prefers-reduced-motion` silences everything.

### Owner refinement — the chat-first floating glass composer (2026-07-05, second pass)

The owner's one note on the approved shape, verbatim: *"what about the chat first?
always floating maybe glass chat input or something that would suit us."* Executed
in place across all three mockups:

- **The composer left the pane.** Execution decision (1) above is reversed: the
  correspondence no longer seats its pen at its foot. The composer is now a
  **floating glass instrument astride the pane seam** — fixed, omnipresent at every
  scroll position and exhibit state. Placement rationale: a question writes to
  *both* panes (the answer lands in the correspondence, the evidence reorganizes
  the exhibit), so the mouth belongs to neither pane alone. The panes still never
  cover each other; the glass hovers *above* the desk, and both panes keep bottom
  clearance so nothing is ever trapped beneath it. The floating input never becomes
  a panel — replies land in the correspondence with the drawn-thread handshake as
  before.
- **Glass in the ink language, not neon.** Warm frosted paper-glass:
  `backdrop-filter: blur(20px) saturate(1.12)` over a 58%-opaque `--j-paper-raise`
  tint, hairline ink border, paper-white inset highlight, deep warm ink shadow.
  Alive at rest: a consult-blue **breathing caret** before first touch; on focus the
  glass **rises 3px** and takes a quiet consult halo; the placeholder **cycles**
  ask / search / command examples (6s, fade-and-rise, paused while composing or
  filled). `⌘K` summons it from anywhere (shown as the kbd affordance, replacing
  §2's `⌘J`, aligning with command-bar muscle memory); Esc-free — it never overlays.
- **Coherent per walkthrough state.** Arrival: inviting — the glass enters with the
  brain's first words, cycling *"Ask — 'what changed since I left?'"*, scope pill
  `whole repo`, and a one-line sub-caption (*ask · search · command — the same
  act*); the eye lands on the hero sentence and the glass before anything else.
  Selection: Maya's selection rides **inside the input as a removable gold chip**
  (`digest pipeline ×` — click restores whole-repo scope). Receipts: Ori's
  just-asked question hangs above the glass as a quiet **echo pill** (*you asked ·
  14:03 — "Says who?…" · answered · 4 hops*), scope pinned to the constraint.
- Everything else holds: two panes never occluding, four exhibits, threads across
  the seam, the six inks, physical stamps, earned motion, and the three five-second
  tests. Screenshots re-taken to `mockups/final/shots/` (1440×900, Playwright).

### Execution note — glass rescue + essence pass (2026-07-05, third pass)

Two operations, two commits:

1. **Glass rescue.** The chat-first floating glass composer described above had been
   built and screenshotted but never committed (the working agent stalled after the
   shots). Verified all three mockups render with the glass astride the seam
   (breathing caret, ⌘K, scope chip on 02, echo pill on 03) and committed the work
   as-is — no repairs needed.

2. **Essence pass.** Owner critique, verbatim: *"i feel we are missing the essence.
   nobody reads so much. should be cleaner, more on demand. the presentation with
   cards is very descriptive by default."* Applied the essence principle
   (`2026-07-05-essence-principle.md`) to all three finals: **the brain answers, it
   doesn't present.** Cards/dossier entries/hops default to name + one signal + one
   delta — no sentences. Prose is opt-in: feature-card lines appear on hover,
   constraint sources appear on hover, moment quotes appear on hover, and full
   briefs/observations/understanding paragraphs sit behind `<details>` clasps (⋯).
   The brain's correspondence replies are now 1–2 short sentences + citation chips
   (Ori's "Says who?" answer went from a 47-word paragraph to two clauses and four
   hop chips). The raw transcript line stays whole — it IS the receipt.

   Ruthless word audit (visible words, rendered `innerText` at 1440×900 — closed
   `<details>` excluded):

   | Mockup | Before | After | Reduction |
   |---|---|---|---|
   | `01-arrival.html` | 508 | 201 | −60.4% |
   | `02-selection.html` | 602 | 239 | −60.3% |
   | `03-receipts.html` | 552 | 220 | −60.1% |

   The five-second tests still pass — faster, since the verdict, the marks, and the
   one red thing are nearly all that remains. Kept intact: two panes, floating glass
   composer, four exhibits, seam threads, six inks, stamps, earned motion.
   Screenshots re-taken to `mockups/final/shots/` (1440×900, Playwright).
