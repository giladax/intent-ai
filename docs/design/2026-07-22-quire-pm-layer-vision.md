# Quire, the Next Phase — The Org's Product-Management Layer

**Date:** 2026-07-22 · **Status:** Vision / forward-looking (not the demo cut) · **Author:** Fable
**Companion to:** `2026-07-22-org-platform-experience.md` (the buildable demo). This doc answers a different, larger question the founder asked: **what does org product management BECOME** when promises, code, sessions/reasoning, and alarms are one living, evidence-bound graph that pushes decisions to whoever can act? Thought against three incumbents — **Jira, GitHub, Obsidian**.

**The line held throughout (founder's, non-negotiable):** no fluff, nothing passive. Every surface pushes a decision to the person who can act; understanding is bound to evidence and cross-examinable; **the product is the org's memory that argues back, not a dashboard you read.**

**Grounded in what exists today** (so this is extension, not sci-fi): signed **obligations/promises** with fate (`entity_graph.py::PromiseFate`), the **entity graph** with three moods — observed / proposed / signed — and reason-aware suppression, **sessions as reasoning** coupled to commits (the coupling contract), the **collision taxonomy** already computed deterministically (`events.py::collisions` → aligned / silent-drift / drift-in-context / all-talk-gap / silent-build-risk / recovered), quote-backed **alarms** (`alarms.py`), and **stakes** scoring. The next phase is mostly *composition and surfacing* over primitives that already run.

---

## 1. The one-line positioning

**Quire is the org's *alignment layer*: the place where what you promised, what you built, and why you built it are one cross-examinable record — and where "is what we built still what we wanted?" is answered continuously, with the quote, and handed to whoever can act.**

- **vs Jira — Quire is the planning layer where status is *derived, not typed*.** Jira's board is self-reported and rots; the plan drifts from the code and nobody trusts it. Quire's plan is *signed promises bound to evidence*, and a promise's status is *computed from what the code actually did* — kept, drifting, broken, recovered — never from a human dragging a card.
- **vs GitHub — Quire is the layer that gives PRs a *memory of intent and reasoning*.** GitHub holds implementation truth but reviews each PR in isolation, with no memory of what the org promised or why the author chose what they chose. Quire rides *on top of* GitHub and judges every PR against org intent + the session reasoning that wrote it.
- **vs Obsidian — Quire is the org brain that is *auto-derived, shared, and comes to you*.** Obsidian is a second brain you hand-tend, passive and personal. Quire's understanding is derived from evidence, cross-examinable to a quote, shared across the org, and it *pushes the decision to you* instead of waiting in a vault.

One sentence to a stranger: *"Jira is where you say what you'll do; GitHub is where you do it; Quire is where the two are held against each other, continuously, and told on when they diverge."*

**The category-defining claim (the biggest honest version):** **Quire is the operating system for the AI-native org — one evidence-bound org graph you pivot by perspective, where intent is signed promises, implementation is continuously checked against them by the same machines that write the code, and the org's understanding derives itself from what shipped. It is the first source of truth that cannot rot, and it makes an entire practice obsolete: the status meeting, the hand-kept board, the stale wiki, the sign-off workflow, PR-review-in-isolation, and the quarterly "are we still aligned?" panic.** Every other tool is one lens welded to the glass — Jira sees tickets, a spend tool sees spend, an HR tool sees people, a wiki sees pages. Quire holds the whole graph and lets you pick the lens; the human's job narrows to judgment and signing, and everything else the org computes.

**The one-liner that draws the line:** *"Every other tool is one lens welded to the glass. Quire is the org's graph — you pick the lens."*

---

## 2. The vision narrative — what product management becomes

Today, product management is a **reconciliation tax**. A PM spends their week making three disconnected surfaces agree: the roadmap (Jira), the code (GitHub), and the shared understanding (a wiki, a deck, tribal memory). Status is a *claim* a human types; alignment is a *feeling* checked at a retro; the "why" behind a decision evaporates the moment the Slack thread scrolls away. The board is a fiction everyone politely maintains.

Quire dissolves the reconciliation tax by making the three one graph. A **promise** is created (mined from a doc, or distilled from a session where a human worked out product direction) and **signed** — that signature is the only authority act. From that instant the promise is *live*: every PR touching its territory is judged against it, every verdict updates its fate, every coupled session records *why* the change was made in the author's own words. The PM never updates a status field because **there is no status field** — a promise's state is the last thing the evidence said about it. "In progress" becomes *"drifting — PR 47 collided with it 2 days ago, here's the quote."* "Done" becomes *"kept — three checks confirm it holds."* "Blocked" becomes *"all-talk-gap — discussed for two weeks, nothing built."*

The PM's core question — **"is what we built still what we wanted?"** — stops being a quarterly ritual and becomes a *continuous fact the org computes overnight*. Standup is replaced by the org telling you, before you sit down, exactly which promises drifted, with the receipts. Sprint review is replaced by a ledger of promises kept, broken, and recovered that *nobody assembled by hand* — it assembled itself from what actually shipped. The roadmap is no longer a plan you defend against reality; it is a set of living promises you can **cross-examine against reality** at any moment, clicking from a bold claim ("we protect refunds over $50") down through the verdict, the diff, the session reasoning, to the exact line — and see who signed it.

The product-management artifact is no longer a document. It is **the org's memory that argues back.** You ask it "are we still doing what we said about refunds?" and it doesn't hand you a wiki page someone wrote in March; it answers from the last thing the code did, and shows you the quote. When it disagrees with you, it disagrees with *evidence*.

---

## 2‑A. Why now, and how big — the AI-native inflection

*(Founder, 2026-07-22: "We should think big because this industry is not up to date at all.")* The incumbents aren't merely imperfect — they were built for a world that is ending. **Jira's ticket is a 2002 metaphor** for humans hand-declaring and hand-tracking work. **Wikis and notes-apps are human-typing-era tools** — a page is only as fresh as the last person who remembered to edit it. **Code hosts have no memory of intent or reasoning** — they hold the *what* and lost the *why* the moment the PR merged. Every one of them assumes the bottleneck is humans typing things down and keeping them in sync. That assumption just broke.

**The inflection — why NOW.** Agents now write most of the code, and — the primitive this whole system already captures — **their reasoning is captured as they write it** (sessions-as-reasoning, coupled to commits, running today). Simultaneously, when intent is *signed promises* (running today) and implementation is *continuously machine-checkable against them* (the collision taxonomy + verdicts, running today), the three surfaces that a PM used to reconcile by hand — plan, code, understanding — are no longer three surfaces maintained by three humans. They are **one graph the machines keep current as a side effect of doing the work.** The reconciliation tax isn't reduced. It is **structurally eliminated** — there is nothing left to reconcile, because nothing was ever separately typed.

**What becomes possible that was impossible in a human-typed world:**

- **The org plans in promises and lets agents execute against them, with alignment checked continuously — not at a retro.** A promise isn't a ticket an agent reads and forgets; it is a live contract the agent's every PR is judged against the instant it opens. *(Traces to: signed obligations + `events.py::collisions` + the verdict pipeline — all running.)*
- **The org's memory is queryable by the agents themselves, mid-task — it doesn't just inform humans, it governs the work as it happens.** The MCP brain already serves org understanding to any agent mid-session; extend it and an agent can ask, before it writes a line, *"what has this org promised about refunds, and why?"* — and be bound by the answer. Governance moves from after-the-fact review to *at-the-keystroke context*. *(Traces to: the MCP brain, `brain_enter`/`brain_feature_context`, running today.)*
- **A single source of truth that is true because it is derived from what shipped, not maintained by anyone — the first org tool that cannot rot.** Every prior "source of truth" decayed the moment reality moved past the last human edit. A derived one moves *with* reality by construction. *(Traces to: `PromiseFate` computed from checks, never typed — running today.)*
- **The human role collapses to judgment and signing — the Docket is the whole job.** Tracking, reporting, status-reconciling, retro-assembling — all machine work now. What's left is the irreducibly human act: deciding, and putting a signature on the record. *(Traces to: the observed/proposed/**signed** three-mood mutation path — the only authority act, running today.)*

**The 10x — and what it obsoletes.** The 10x is not "a faster board." It is the **removal of an entire layer of human labor** — the reconciliation tax — that every current tool exists to *manage* rather than *eliminate*. Quire doesn't make you better at status meetings; it ends the reason status meetings exist. Concretely, the *practice* that goes obsolete, not just three products:

| The stale practice | Why it existed | What replaces it in Quire |
|---|---|---|
| The **status meeting / standup** | Humans self-report because nothing else knows the state | Computed feature state; the overnight drift tap. Nobody reports; the org already knows. |
| The **manually-maintained board** | A shared place to declare and drag work | Living promises grouped under features; fate derived, never dragged. |
| The **stale wiki / org brain** | A place to write down shared understanding | Auto-derived, evidence-bound, cross-examinable memory that updates from what shipped. |
| The **sign-off workflow** | Ceremony to record human approval | One visible signing act, everywhere — machines propose, a human signs. |
| **PR-review-in-isolation** | The reviewer has no memory of org intent | Every PR judged against signed promises + the session reasoning that wrote it. |
| The **quarterly "are we aligned?" panic** | Alignment was only ever checked at rituals | A continuous fact the org computes; drift is caught the night it happens. |

**The guardrail that keeps big from becoming sci-fi:** every leap above lands on a primitive already running in this repo — promises/fate, the entity graph's three moods, the collision taxonomy, quote-backed alarms, sessions-as-reasoning, the coupling contract, the MCP brain. Nothing here requires a capability we don't have; it requires *composing what we have at org scale.* And every surface, even at horizon, holds the line: it **pushes a decision** (the Docket) or **answers a cross-examination with a quote** (the Feature Overview). No passive read survives the scale-up — the bigger this gets, the more ruthlessly it stays *act-or-cross-examine*, never *skim*.

**The Feature-as-unit and the Docket/Overview push-pull get bigger here, not different.** At this scale the Feature is the org-spanning living-promise substrate that *agents operate on*, not just a lens humans browse; the Docket is where the org's continuous self-checking surfaces the calls only a human can make; the Overview is that same substrate, pulled, when you want to see rather than act. Same two poles — now the operating surface of an AI-native org.

---

## 2‑B. The deeper unlock — one graph, any perspective

*(Founder, 2026-07-22, generalizing the Feature ruling: "consider we have a knowledge graph where every node kind can be presented as top level — it's a matter of required perspective. Features / spendings / whatever are just common lenses.")*

The Feature is not Quire's hardcoded unit. It is the **first and most common lens** over something more fundamental: **one evidence-bound org graph**, where *any node kind can be promoted to the top-level view, and the required perspective picks it.* This is already the product's DNA — `CLAUDE.md`: *"the event river is the substrate; Feature is the primary lens."* The founder is elevating "lens" from Feature-only to **any node kind**: feature, spend, person, risk, promise, decision, customer, team — each a *common perspective* over the same nodes, not a separate tool or a separate schema.

**Why this is the true leapfrog.** Every incumbent is a **single-perspective silo** — one lens welded to the glass. Jira can only see work-as-tickets; a spend tool can only see money; an HR system can only see people; a wiki can only see pages. Each is a *partial view* of the org that has been frozen into a product. Quire inverts it: hold the org as **one graph**, and a "tool" becomes a *perspective you pivot to* rather than a database you switch to. Ask for the **feature** perspective and promises group under features with computed fate; ask for the **risk** perspective and the same graph surfaces unwatched drift and unsigned exposure; ask for the **spend** or **person** or **customer** perspective and the same nodes reproject. Nothing is duplicated across tools because there was only ever one graph. **This is what makes single-perspective tools look like partial views of what Quire holds whole.**

**Grounded, not sci-fi — a new lens is a projection, not a subsystem.** The entity graph already runs (`entity_graph.py`): entities are generic — a name, an identity sentence, aliases, typed *holdings*, and `relate` edges (`part_of` / `depends_on`) — with the three moods (observed / proposed / signed) and reason-aware suppression. Nothing in it hardcodes "Feature"; a Feature *is* a perspective that gathers entities holding certain promises and rolls up their fate. A **spend** or **risk** lens is the same act with a different gather-and-roll-up rule over the same nodes — a **projection over the graph, not a new store, not a new pipeline.** That is the guardrail: perspective-pivot is credible precisely because it adds *views*, not *machinery*.

**How it composes with the prior rulings — bigger, coherent, not a stack:**

- **The Docket (push) stays lens-agnostic by nature.** It ranks *decisions awaiting a human* regardless of which perspective they belong to — a promise-break (feature lens), an unsigned spend exposure (spend lens), an unwatched risk (risk lens) all land on the one Docket by stakes. "What needs me now" was never per-tool.
- **The Overview (pull) becomes *perspective-pivotable*.** You come to check "what's going on" from **whatever lens the moment requires** — features today; spend, risk, people tomorrow — each drillable to the same evidence and the same quote. Same destination, pivotable glass.
- **The core primitives are lens-agnostic; only their *rendering* is per-perspective** (see §3‑A below). A promise, its fate, a signing, a collision — these live on the graph, not inside "Feature." A perspective decides *which nodes to gather and how to roll them up*, then renders them; it never owns the primitive.
- **The demo cut does NOT abstract this.** Phase 0 ships exactly one lens — **Feature** — buildable and concrete; do not over-generalize the near-term build. The any-perspective substrate is the horizon this vision names, and it is a projection layer added *later* over a graph that already exists.

---

## 3. The new primitives — and what they retire

| New Quire primitive (real today) | What it *is* | Old PM primitive it retires / absorbs |
|---|---|---|
| **Promise** (signed obligation) | A statement of intent, bound to code locations, carrying verbatim provenance | The **ticket / story** as the unit of intent. A promise is a ticket that can't lie about whether it's done — because "done" is computed. |
| **Fate** (kept / drifting / broken / recovered) | The promise's state, *derived from checks* (`PromiseFate` + the collision taxonomy) | The **status column** and **story points**. No human drags a card; no one estimates "done-ness" — the code reports it. |
| **Drift** (silent-drift / drift-in-context) | The gap between a signed promise and what shipped, quote-backed, with "is anyone watching?" | The **retro finding** and the **"we forgot about that" moment.** Drift is caught the night it happens, not at the post-mortem. |
| **Alignment** | The org-wide roll-up: which promises hold, which drifted, how many are unwatched | The **status report / exec dashboard.** But it's derived and cross-examinable, not typed and trusted-on-faith. |
| **The signing** | The single human authority act — machines propose, humans sign | **Approval workflows, sign-off fields, "PM accepts" ceremonies.** One act, visible, on the record, everywhere. |
| **Session-as-intent** | A product-direction conversation distilled into candidate promises a human signs | The **planning meeting → Jira epics** pipeline, and the **PRD nobody reads.** Intent is captured where it's actually formed (in the working-out), then signed. |
| **Session-as-reasoning** | The coupled coding session — *why* a change was made, in the author's words | The **lost context of a PR.** "Why did we do this?" has an answer that survives, quoted and cross-examinable. |
| **The Docket** | The queue of decisions awaiting a human's signature, ranked by stakes | The **standup, the triage meeting, the "what needs me today" scramble.** |

**What is fully obsoleted:** the hand-kept org wiki (Obsidian/Confluence as the *shared understanding of intent* — Quire derives it); the status column as a source of truth; story-point estimation as a proxy for progress (progress is measured in promises kept). **What is absorbed, not killed:** Jira's *planning-as-intent* (promises are a better ticket), the retro's *learning* (reason-aware suppression already turns a signed dismissal into a lesson the system remembers).

### 3‑A. The primitives are lens-agnostic — perspective renders, it never owns

Every primitive above lives on the **graph**, not inside "Feature." A promise, its fate, a drift, a signing, a coupled session — these are nodes and edges and moods on the one substrate. A **perspective** does exactly two things: it decides *which nodes to gather* and *how to roll them up*, then renders the result. It never owns the primitive.

- Through the **Feature** lens, a promise renders grouped under the feature it serves, fate rolled up per feature.
- Through a **spend** lens, the same evidence-bound nodes gather by cost and render as exposure and commitments; a "drift" becomes *spend outrunning what was signed off*.
- Through a **risk** lens, the gather is unwatched drift + unsigned exposure; the same collision taxonomy renders as *what's on fire and who's holding it*.
- Through a **person / team** lens, the gather is who touched what; the same sessions-as-reasoning render as *what this person decided and why*.

Because the primitive is shared, **the Docket and the Overview are lens-agnostic by construction** — the Docket ranks decisions across every perspective at once; the Overview is any single perspective, pulled. Adding a lens is a projection over nodes that already exist (§2‑B), so the primitive table above is written once and *every* future lens inherits it. This is the credibility guardrail restated as a rule: **new perspective, no new machinery.**

---

## 4. Integrate vs. replace — the call per incumbent

- **GitHub — RIDE ON. Never replace.** GitHub is implementation truth and stays exactly that. Quire is already a layer on top (the adapter reads PRs, publishes verdict comments, parses `Claude-Session:` trailers). Deepen the ride: PR checks/statuses, GitHub Projects as an *optional mirror* of promise fate (so teams living in GitHub see Quire's verdicts where they already work), webhooks replacing the poll. We never ask anyone to leave GitHub; we make their PRs remember intent.
- **Jira — EXPOSE, THEN REPLACE (founder-ruled 2026-07-22).** We do not open with "leave Jira" — too big an ask, too easy to refuse. We open by making the board *honest*, and let the contradiction do the selling. Import Jira epics/stories as **candidate features/promises** the PM signs, then show **Quire's computed fate beside Jira's self-reported status on the same row**: *"board says Done — code says drifted 2 days ago, here's the quote."* That single side-by-side ("done vs. drifted") is the most persuasive artifact in the product — it needs no argument. Run the two in parallel while trust builds; the board becomes visibly the fiction and Quire the fact, and the switch happens because the team stops trusting the typed column, not because we told them to. Long-run the board goes — but *expose* is the wedge, *replace* is the consequence, never the pitch.
- **Obsidian — OBSOLETE the org-wiki use; leave the personal one alone.** Obsidian-as-*personal* thinking tool is fine and orthogonal. Obsidian/Confluence-as-*the org's shared brain* is exactly what Quire replaces with something auto-derived, evidence-bound, cross-examinable, and push-based. The pitch: *"Stop tending a garden of pages that go stale the moment code moves. Your org brain should update itself from what shipped, and tap you when it matters."*

Net shape: **Quire sits above GitHub, exposes-then-replaces Jira's board, and obsoletes the hand-kept org-wiki.** It is the connective, evidence-bound layer none of the three are — because each owns one corner (plan / code / memory) and none holds them *against each other*.

### The scope boundary — Quire is a state-of-record you pull, not a task tracker (founder-ruled 2026-07-22)

The sharpest question about the PM layer was: *does Quire track tasks?* The founder ruled it, verbatim: **"But it's not only actions there should be an overview. I want us to be the place they come to check what's going on with features etc."** The unit you check on is the **Feature** (the default lens; §2‑B generalizes it to any perspective), and the line against task-tracking is drawn precisely:

- **Quire does NOT own task-tracking or assignment.** There is no owner+horizon "commitment" primitive, no sprint, no board Quire maintains. Sequencing who-does-what-by-when stays in whatever lightweight tracker a team already uses. Quire sits *beside* it, not in its chair.
- **Quire IS the place of record for the live state of the org, viewed through the lens you need — Feature first.** The Feature is the primary lens (per `CLAUDE.md`: *"Feature is the primary lens … intent and implementation are two kinds of evidence sliced by it"*) and the common default; under each feature: its signed promises, their computed fate (kept / drifting / broken / recovered), its alignment roll-up, the sessions that touched it, recent activity — every line drillable to the quote. But Feature is *a* lens, not *the* hardcoded unit (see §2‑B): the same graph pivots to spend, risk, person, customer as those lenses are added. **"What's going on with X"** has one honest answer here, from whatever perspective X lives in, derived from what the code actually did — never a status someone typed.

This is not in tension with the no-passive-read principle — it *sharpens* it (see the experience doc's push/pull framing): a **summary pushed to your phone** is fluff and stays cut; an **overview you pull** — a destination you actively visit to check state through a chosen lens, cross-examinable to evidence — is the org's memory made browsable, and it is core value, not fluff. Push vs. pull, and hand-typed-summary vs. computed-live-state, is the whole distinction.

So Quire owns **intent, alignment, and the org's state-of-record across perspectives** — and deliberately not task-tracking (no owner+horizon commitment primitive, no board it maintains). It is where you come to ask *"is what we're building still what we wanted, and what's the state of everything?"* — beside, not on top of, wherever the team assigns the work.

---

## 5. A PM's day on Quire

**Before they open a laptop.** Their phone already told them the one thing that couldn't wait — overnight, `refund-agent` drifted: a PR raised the cap while the guard held, no one was watching. The message carried the quote and the one fix. They didn't have to *find* it in a board.

**They open Quire to the Docket, not a dashboard.** Ranked by stakes: the drift to adjudicate (sign the risk or send it back), two promises drafted on a newly-added repo awaiting signature, three intent cards distilled from yesterday's strategy session. Each is a *decision with a verb*. There is no "read the board and figure out what matters" — the figuring-out is done, ranked, and handed over.

**When they want to check on something — not act, just *see* — they pull the Feature Overview.** "How's the refunds feature doing?" isn't a decision waiting on them; it's a question, and Quire is the place of record for the answer. They open the feature: its promises grouped beneath it, each with computed fate (three kept, one drifting, the quote right there), its alignment, the sessions that shaped it. Nobody typed this state — it's the last thing the code did. This is the pull pole to the Docket's push: **the Docket is what needs you; the Feature Overview is what's going on.** Both are the same evidence graph, entered from two intents — *act* vs. *check*.

**No standup.** The team doesn't recite status, because status isn't self-reported — it's on the ledger, computed. The stand-up's only real content ("what's blocked, what drifted, what needs a call") is already the Docket. The fifteen minutes go to the *decisions*, not the *reporting*.

**Mid-morning, a strategy call.** The PM and an agent (or a colleague) work out a change of direction on premium refunds. Instead of translating that into epics afterward, they upload the session *as intent*. Quire distills it into candidate promises with the exact quotes from the conversation; the PM signs the two that are real. The org's contract just grew — and the next PR that touches refunds is judged against what they decided this morning. **Planning became signing; the PRD wrote and filed itself as evidence.**

**Someone asks "why did we ever cap refunds at $50?"** The PM doesn't dig through Slack. They click the promise, walk the reasoning: the session where it was decided, quoted; the checks that kept it; the one PR that tested the boundary. The answer is *cross-examinable*, not a half-remembered story. The org's memory argues back, with receipts.

**End of day, no sprint-review to prep.** The ledger of promises kept / drifted / broken / recovered assembled itself from what shipped. If the PM wants the narrative — the composed retrospective — it's in the journal, one deliberate click away. But nothing *asked* them to read it; the decisions already came to them.

The PM's job shifts from **reconciling three surfaces and reporting status** to **making the judgment calls the machine surfaces** — which is the only part that ever needed a human.

---

## 6. Phases — from the demo cut to this horizon

**Phase 0 — the demo cut (built / in flight; `2026-07-22-org-platform-experience.md`).** Org of many repos, paste-a-URL onboarding, every PR reviewed against signed promises, sessions coupled and reasoning in the margin, sessions-as-intent, quote-backed alarms to Telegram, the Docket as the landing. This is *alignment on one repo at a time* — the mechanism proven end to end.

**Phase 1 — the living roadmap = the Feature Overview (the pull pole).** Promote the **Feature** (already the product's primary lens) to the org-spanning unit of the roadmap. The roadmap is not a list of promises — it *is* the **Feature Overview**: every feature with its promises grouped beneath it, each promise's fate computed from the collision taxonomy (created / signed / drifting / kept / broken / recovered), an alignment roll-up per feature, the sessions that touched it, recent activity — all drillable to the quote. This is the destination the founder ruled Quire must be: *"the place they come to check what's going on with features."* Status is never typed; it's the last thing the evidence said. **The expose-then-replace Jira bridge lands here:** import Jira epics/stories as candidate features/promises the PM signs, and render Quire's computed fate beside Jira's self-reported status on each row ("board says done · code says drifted — here's the quote"), running side by side until the typed column loses the team's trust on its own. The alignment roll-up (which features hold org-wide, how many promises unwatched) is the exec view of the same surface — derived, never typed. *Mostly composition over Feature-as-lens + `PromiseFate` + `collisions` + the entity graph, which already run.*

**Phase 2 — continuous alignment replaces the rituals.** The overnight drift report (standup's replacement) and the self-assembling promise ledger (sprint-review's replacement) become the org's rhythm — push-based, silent when healthy. Role→channel routing (the drift that's engineering's goes to engineering, the promise-break that's exec's goes to exec) lands here. GitHub Projects mirror of promise fate for teams who live in GitHub. This is the phase where a team could genuinely *stop opening Jira*.

**Phase 3 (horizon) — the org that argues back.** Ask the graph, in plain language, "are we still doing what we said about X?" and get an evidence-bound answer that walks to the quote — the cross-examination surface generalized from the demo's manuscript to the whole org. Cross-repo, cross-team promises. The org's memory as an interlocutor, not a wiki.

Each phase is defensible from the last and grounded in a primitive that exists — no phase is a rewrite.

---

## 7. Open questions for the founder (genuine forks, not details)

1. **Jira posture** — ✅ **RULED 2026-07-22: expose-then-replace.** Import stories as candidate features/promises; show computed fate beside self-reported status; let "done vs. drifted" sell the switch. Baked into §4 and Phase 1.
2. **The scope boundary / unit of the overview** — ✅ **RULED 2026-07-22: the Feature, not the ticket.** Quire is the place of record for feature state, not a task tracker; no owner+horizon commitment primitive. Baked into §4's boundary and Phase 1's Feature Overview.
3. **Whose signatures?** The demo is a single founder signing everything. The PM-layer vision needs *roles* — who may sign a promise into the org contract, who may sign off a drift, whose judgment the Docket routes to. This is org-membership + authority policy (deferred to O6 in the demo). It's the load-bearing question for "an org uses this," and it's genuinely a product-design call, not just auth.
4. **Do promises/features live above the repo?** Today obligations are per-workspace. A living Feature Overview wants features that span repos ("premium customers are always routed to a human" cuts across three services). Promote features + their promises to org-level entities that bind to *multiple* repos' code — a real graph change — vs. keep them repo-local and roll up? (Recommend org-level; it's the difference between a feature overview and a pile of per-repo contracts.)
4. **What is the unit a team plans in?** If the ticket is retired, teams still need to sequence and assign work-in-flight (not just intent). Is there a lightweight "commitment" primitive (a promise *plus* an owner and a horizon) — or does Quire deliberately *not* do task-tracking and stay the alignment layer beside a lightweight tracker? (This is the sharpest scope boundary in the whole vision — worth the founder's explicit call.)
5. **Continuous vs. cadence.** "The org tells you what drifted overnight" — is the rhythm truly continuous (tap the moment it breaks, already how alarms work) *plus* a daily digest-of-decisions, or do we deliberately batch to protect attention? The demo doc already flags the daily "anything waiting?" tap; the PM layer makes the cadence question strategic.

---

*Uncommitted by intent — a forward-looking companion, deliberately kept separate from the buildable demo design so the near-term build stays clean. Nothing here is scheduled; it is the horizon the demo cut is walking toward.*
