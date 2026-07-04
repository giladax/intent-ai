# Strategic Review — 2026-07-04

> Scope: does today's entire direction serve the grand plan (PRD v0.3.2)? Not a code review.
> Inputs: PRD v0.3.2 · future-knowledge · consolidation-iteration-0 · today's arc (fidelity report →
> understanding-stage rewrite → fidelity-after → agents-core → zoom design → digestion-v2 proposal →
> owner reframe) · today's ~40 commits · repo state at `eb89236`.

---

## Verdict

**Today's first half was exactly right; the second half is momentum, not strategy.**

The fidelity audit → understanding-stage rewrite → measured re-run is the best-executed day of
engineering in this repo's history: a pre-registered baseline, a real architectural insight ("LLMs
judge; code carries"), an 11/12 acceptance pass, and defects that genuinely disqualified the MVP
("derived" context laundered from fabricated provenance) removed at the root. The PRD itself named
digest fidelity a load-bearing precondition (v0.3.2), so this work was on the critical path.

But the precondition was **met by mid-day** — recall 9/9, 3/3, 2/3 on re-digested sessions, zero
precision violations, provenance channels real — and the arc did not stop. By evening the repo held
*three generations of digestion architecture in one day*: the rewritten pipeline (shipped, passing),
a competing agent arm (built, zero experiments run), and a v2 "receiver" proposal that would replace
both — designed against the defects of an agent whose rolling-notes feature isn't even implemented
yet. Meanwhile the thing the PRD calls "the proof, not a demo" — the ETC/CVR measurement harness —
sits at its invalidated June-28 v1, untouched. The measurement-v2 spec is a day old and unowned.
`src/mcp` received zero commits. The Serve stage of the loop got nothing.

The pattern has a name: **the substrate keeps earning the right to be perfected because perfecting
it is tractable, while the product claim stays unfalsifiable because testing it is scary.** The PRD's
own kill-switch discipline exists precisely to prevent this. The fidelity work sharpened the
knife; nobody has cut anything with it.

**One number that should discipline the next three days:** the consolidation doc estimated the
whole MVP at 6–8 working days, with the harness and approval UI as the long pole. Today consumed
one of those days on work the MVP table doesn't contain, and produced two more designs
(agents-core experiments E0–E3, digestion-v2) that would consume the rest of the week if executed.

---

## Q1 — Fidelity arc: spearhead-serving or substrate perfectionism?

**Both, split cleanly at mid-day.**

**Defensible (audit → rewrite → measurement):** The PRD v0.3.2 amendment makes fidelity the gate
for the measurement run, and the audit proved the gate was failing in ways that would have
invalidated the MVP result silently: 101/102 moments with fabricated evidence, digests asserting
the *opposite* of a session's end state (F1), self-report laundering (F4). A treatment arm serving
constraints "derived" from that substrate would have produced an unfalsifiable or falsely-positive
measurement. Fixing this first was correct, and the execution — captured baseline, pre-registered
acceptance, deterministic-vs-LLM fix discipline — is the EDD principle honored for real.

**Not defensible (everything after the fidelity re-run):** The PRD says fidelity *gates the
measurement run*. It does not say fidelity must be *maximized* before measurement work begins, and
the consolidation doc explicitly says the harness (WS-C) builds in parallel from day 1. Once A1–A4
and A7–A9 passed, the precondition was satisfiable with two small follow-ups (derived confidence
for A5; `--force` re-digest of `b9ab1a0c`). Instead the day produced: an agent substrate
(LangGraph core + digest agent), a four-experiment EDD program (E1, E1b, E2, E3), a zoom-view spec,
a rolling-narrative design, and a v2 receiver proposal. None of these is on the PRD's MVP table.
All of them improve the same pipeline stage that just passed its acceptance bar.

**Cost of the MVP claim aging another week:**
1. **The story-time arm has wall-clock latency you cannot compress.** It needs 5–10 real seeded
   working sessions. Every day not started is a day the generalization arm slips — and without it
   the MVP result is "works on the repo that built it," which convinces nobody.
2. **Risk-inversion.** If the ETC/CVR test *fails or kills* (a real possibility — the pass bar is
   aggressive), the correct response would be to rethink the served-context loop, which would
   change what digestion fidelity level is even required. Perfecting digestion before the loop is
   validated is optimizing a component whose requirements are unconfirmed.
3. **The wedge's external clock.** The PRD itself says feature-aware agent context is "a crowded
   space." The moat (alignment) is gated behind the MVP bar. Every week the bar isn't attempted is
   a week the crowded-space wedge and the moat both stand still.

**A concrete tell:** the single failed acceptance item (A5, confidence saturation — confirmed on
three independent runs) has a designed, deterministic, ~hours-sized fix (derive confidence in code:
anchored+supported→high, anchored→medium, unanchored→low; it structurally cannot saturate). Instead
of shipping it, it was queued as experiment E2/V2-E3 inside an agent-topology research program. A
one-day fix became a workstream dependency. That is substrate perfectionism in miniature.

## Q2 — Digestion-v2 receiver framing: right generalization or premature abstraction?

**The contract is right; building against it now is premature. Split the two.**

The owner's force is real and half-correct: multi-source *is* the product's point, and a receiver
that can only read transcripts would need rework exactly when P2 moat work starts. The
`EvidenceStream`/`Anchor`/one-delta-gate contract (§4 of the proposal) is genuinely good design —
and it is *cheap*: a types file, a lint rule, a paper re-derivation at review time. Keeping that as
a binding design commitment costs almost nothing and buys the seam.

But the *build* fails YAGNI on three counts:

1. **The abstraction is derived from n=1.** Every generalized element — episode detection
   thresholds, corroboration rules, rendering density, claim vocabularies — is *guessed* for
   Jira/Slack. The proposal admits the boundary "cannot be eval-scored until a second source
   exists" and substitutes a lint rule plus a paper exercise. Abstractions drawn from one example
   are reliably wrong in the details; the seam will be redrawn when the second source is real
   regardless of how carefully it's drawn today.
2. **It's a third-generation design replacing systems with zero operational history.** The
   understanding-stage rewrite shipped *this morning*. The v1 digest agent has run **no
   experiments** (E1 unrun; its rolling-notes mechanism is prompt-only; the sittingNarratives
   amendment is designed-not-implemented — the proposal's own D3). v2's diagnosis section
   critiques defects of a system nobody has measured. This is designing v3 against v1.5's
   theoretical weaknesses.
3. **Scope accreted mid-design.** Three owner forces arrived during the writing (receiver →
   two-phase → knowledge tools), each expanding the topology before the previous expansion had
   evidence. The document is internally rigorous — the pre-registered V2-E1…E4 ladder is the right
   *method* — but the method's existence doesn't justify running it now. The experiments' referee
   is a fidelity eval fit to four hand-cataloged sessions; iterating topology against n=4 ground
   truth is an overfitting machine.

**The honest sequencing the proposal itself half-admits:** open question 6 asks whether a thin
Jira/Slack adapter should follow "shortly after v2 promotion" — which, per the PRD's own rule
("no integration enters scope before the MVP bar is met"), is a question that answers itself. If
the second source can't exist before the MVP bar, the receiver core has no test before the MVP bar,
so the receiver core should not be *built* before the MVP bar. Adopt the contract, freeze the
proposal as design-of-record, build nothing.

## Q3 — Where is serving?

**Nowhere, and this is the day's most consequential gap — because a serving win was sitting there.**

Zero commits touched `src/mcp`. The web commits are digestion-inspection UI (session-detail
window hints, `window-membership.ts`) — instruments for the substrate, not understanding for a
consumer. The Correspondence (shipped yesterday) received nothing. So: digestion became
trustworthy, and *no consumer can tell*.

The uncomfortable specific: the rewrite's occurred-time fix is itself a **product** improvement —
before today, every digested session collapsed to a single instant on the river, which is a direct
violation of "time is the axis" on the product's primary surface. That fix is live in the
pipeline… for exactly **three re-digested sessions**. The rest of the corpus (including everything
in `.intent/raw-sessions/`) still carries digest-time stamps, fabricated evidence strings, and
`chunks[0]` provenance in the very rows that `brain_search`, `brain_file_context`, and the Journal
serve today.

**The shortest path from today's fidelity gains to a visible win is one command away:** re-digest
the archived corpus with the rewritten pipeline (`--force` over `.intent/raw-sessions/`). That
single batch job makes the river chronologically real, makes every evidence quote in served
context traceable, and fixes `b9ab1a0c` (the resumed-session poster child that was never
re-digested — see Q4). It converts eval-artifact gains into product-surface gains in an afternoon,
with code that already exists. That it wasn't done — while a v2 architecture was being designed —
is the clearest evidence that the day optimized the pipeline as an object of study rather than as
a supplier to the Serve stage.

## Q4 — The eval story: balanced against what the PRD says matters?

**No. Today's eval investment is 100% substrate-internal; the two product surfaces have zero
measurement between them.**

- **Digestion fidelity** (`run-fidelity.ts`): built today, genuinely good, already earning its keep
  (it caught the A5 regression and the concurrency incident). Keep.
- **Agent outcomes** (ETC/CVR): the PRD calls this "the proof, not a demo" and dedicates a page of
  binding rules to it. Code state: the invalidated v1 (June 28), retired task list, unowned "live
  collection" long pole. One day old as a spec, zero days of work.
- **Search / Correspondence**: the PRD calls search "the front door" that "must be cutting-edge,"
  and the Correspondence is the read-write surface of journal-as-product. Measurement: **nothing.**
  Not even a 10-query smoke set with expected episode hits. Nobody can say today whether
  `brain_search` finds the journal-as-product pivot discussion, and nobody would notice if a
  regression made it worse.

Two structural risks inside the fidelity eval itself, worth naming before more weight lands on it:
(a) **n=4 overfitting** — the agents-core and v2 programs both propose iterating topology against
four cataloged sessions; wins will partially be memorization of the catalogs' emphases. (b) **The
hardest case is excluded from the headline** — `b9ab1a0c` (resumed, 3 sittings, 0/5 recall) was
never re-digested, so "recall fixed, no regressions" is true only of the three easier sessions.
The A8 "PASS" is honest in its fine print but the summary claim outruns it.

The balanced portfolio the PRD implies: fidelity eval (exists) · MVP harness (owed, critical) ·
a small search-relevance set (owed, cheap — ~a day, and the audit catalogs already contain natural
queries and their ground-truth episodes).

## Q5 — What to cut/defer, what replaces it, next-3-days

**Cut / defer from the current queue:**

| Item | Verdict | Why |
|---|---|---|
| Digestion-v2 build (two-phase receiver) | **Defer to post-MVP-bar.** Freeze proposal as design-of-record; adopt §4 contract + import-boundary lint now (cheap). | Premature abstraction, n=1 evidence, replaces unmeasured systems (Q2). |
| E1 / E1b / E3 topology & context experiments | **Defer.** | Tuning a stage that passed acceptance; referee overfits at n=4; not on the MVP table. |
| E2 / V2-E3 derived confidence | **Keep — but as a same-day deterministic fix, not an experiment.** | Closes A5, the only failed acceptance item; structurally cannot saturate; hours. |
| Zoom view (Part B web UI) | **Defer.** Part A events (cheap, journal-native) can ride along whenever emit is next touched. | Inspection tooling for the substrate; serves the pipeline's authors, not the product's users. |
| Rolling narrative (sitting narratives as product) | **Defer.** | Journal delight, real but not load-bearing for the MVP; depends on agent arm that is itself deferred. |
| Window-hints UI polish | **Stop here.** What landed today stays; no further investment. | Same category as zoom. |
| Purges / doc truth-sweeps | Done; stop. | Hygiene is complete; further passes are displacement activity. |
| Digest agent (v1) + agents core | **Keep the code, freeze the program.** | The core is small and will serve the search agent later; but no promotion campaign until after the MVP measurement. |

**What takes their place: the MVP table's own critical path** (consolidation WS-A + WS-C, PRD
§MVP), plus one corpus job that converts today's gains into the product.

**Next 3 days:**

- **Day 1 — close fidelity, ship it to the surface.**
  1. Derived confidence in the pipeline (deterministic; kills A5).
  2. Unique index on `sessions.source_hash` + deterministic fidelity lookup (the concurrency race
     is a data-integrity bug on the MVP's substrate — small, do it now).
  3. **Batch re-digest the full raw-session archive** (incl. `b9ab1a0c --force`). Re-run
     `run-fidelity` once; record numbers. Declare the v0.3.2 precondition **met** in the PRD and
     freeze digestion work behind that line.
- **Day 2 — the read path the MVP needs (WS-A items 1–3).**
  4. `feature_files` join + `brain.enter` resolver (candidate list on 0/>1, no silent guess).
  5. `featureContext()` assembler, populated **Brain-derived** from the freshly re-digested corpus
     (the provenance rule is finally satisfiable — that is what today bought).
  6. Start story-time seeding **today** (real working sessions; it's wall-clock, not effort —
     begin the clock).
- **Day 3 — the proof machinery (WS-C).**
  7. Draw the 5 hold-out `TaskCriteria` for intent-ai under the measurement-v2 rules (outside the
     eval checkout).
  8. Build the live-collection runner skeleton (the "unowned long pole": headless sessions, MCP
     toggled, transcript+diff capture) and run **one pilot task, both arms** — not for numbers,
     to shake out the harness.
  9. Stretch: the 10-query search smoke set from the audit catalogs.

By the end of day 3 the project either has a functioning two-arm pilot or a concrete list of what
blocks one — both are worth more to the PRD than any digestion topology experiment.

## Q6 — Unacknowledged contradictions with the PRD / deferred-bets doc

1. **v2 open question 6 vs. the PRD's integration gate.** The PRD: "no integration enters scope
   before the MVP bar is met." The v2 proposal floats a thin Jira/Slack adapter "shortly after v2
   promotion" — where "v2 promotion" is a *fidelity* bar, not the MVP bar. The proposal cites PRD
   §Integrations for its mechanism but never cites the gating rule its own timeline would breach.
2. **`UnderstandingDelta` vs. the F7 trim.** The API review (binding, per PRD §MCP) deferred
   `proposeKnowledgeDelta` because "the trim discipline should apply to the API too," and the
   Week-1 trim cut the Knowledge Delta object as "modeling ahead of validation."
   v2 §4.3 reintroduces a first-class delta object (with a candidate dedicated table) as the
   receiver's core output contract. It name-checks F7 for the MCP entrance but does not
   acknowledge that the *object itself* is the thing the trim cut. Same for future-knowledge:
   "Knowledge Deltas as first-class history" is an explicitly deferred bet being re-entered
   through the receiver's back door.
3. **Agents-core's consolidation agent vs. deferred bets.** "Proposed observations /
   feature-understanding deltas" from cross-session synthesis is future-knowledge's "automatic
   claim promotion" adjacency; the design says specs come later (good) but the deferred-bets doc
   is never cited.
4. **Cost estimate quietly missed by ~4×.** The rewrite design pre-registered "~10–11 calls/large
   session, +1"; the measured run spent ~35–40 Sonnet calls on the large session (32 chunks). The
   after-report notes it as "somewhat above"; nothing revisits the estimate or its budget
   implications for the scheduled daemon digesting every session. Not a PRD contradiction, but an
   unacknowledged miss in a day otherwise defined by pre-registration discipline — and v2's cost
   argument builds on top of it.
5. **Minor:** the fidelity headline ("no regression, only improvement") stands on a set that
   excludes its own hardest member (`b9ab1a0c`, unre-digested) — acknowledged in fine print,
   absent from the acceptance verdict's framing.

(Checked and clean: CLAUDE.md's run-gen0 references were actually swept in `eb89236`; the zoom
view respects Principle 2a — timeline, not graph-viz; sitting narratives are consistent with
journal-as-product.)

---

## Risks, ranked

1. **MVP claim decay (highest).** The falsifiable hypothesis remains untested while its 6–8-day
   estimate is consumed by substrate work; story-time seeding hasn't started and is
   wall-clock-bound. If the wedge measurement keeps slipping, the moat (P2 alignment) slips
   week-for-week behind it.
2. **Architecture churn outrunning evidence.** Three digestion generations in one day; v2 designed
   against unmeasured v1.5 defects. Each generation resets operational learning to zero.
3. **Eval monoculture.** All measurement pressure points at digestion fidelity (n=4, catalog-fit);
   zero pressure on search/Correspondence/agent outcomes. The org is building exquisite
   instruments for the one stage that's already instrumented.
4. **Served-context staleness.** Until the corpus re-digest, the product surfaces serve exactly the
   fabricated-provenance rows the audit condemned — with a fixed pipeline sitting idle beside them.
5. **Cost envelope drift.** ~35–40 Sonnet calls/large session under a scheduled daemon, against a
   pre-registration that predicted ~11; unbudgeted at fleet scale.
6. **Owner-force accretion.** Mid-design scope injections (receiver → two-phase → knowledge tools)
   are each individually reasonable and collectively a mechanism for unbounded design growth;
   the EDD protocol governs experiments but nothing governs design intake.
