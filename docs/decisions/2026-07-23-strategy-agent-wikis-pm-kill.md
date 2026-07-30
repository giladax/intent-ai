# 2026-07-23 — Strategy: the agent-wiki wave, and killing the board that lies

**Trigger:** mem0's "The State of Agent Wikis" (In Context #17, 2026-07-21) —
Karpathy's LLM-Wiki gist became four shipped products in about three months
(Cognition DeepWiki, Factory AutoWiki, LangChain OpenWiki, Garry Tan's GBrain).
Founder directive: read the winds, sharpen the business — "we should kill
Monday and Jira… how do they allow cross-company knowledge, and what do we do."

Written in plain language on purpose. Every claim below names something this
repo has actually shipped or formally designed — no vapor.

---

## 1. The map: what just became cheap, and what is still empty ground

**What the wave proves.** Four teams, four different starting problems, one
identical structure in months: read the sources once, write pages, let the
model keep the pages fresh, let agents read the pages. This is Quire's own
pre-computation bet ("understanding computed on events, cached — zero model
calls at view time") validated by the whole industry at once. The bet was
right. It is also no longer special.

**Now commodity (do not sell this):**
- "We understand your codebase" — DeepWiki gives that away free for 50,000
  public repos.
- Compiled, agent-readable pages from documents — four products do it.
- Soon: reading coding-session transcripts as just another source. OpenWiki's
  Personal Brain already eats Gmail, Notion, and X; session logs are an
  obvious next meal. Assume months, not years.

**The gap the article itself names — and then answers too small.** Its
closing warning: a wiki knows *a document set*; it does not know *decisions,
rejected approaches, what already failed, who said so*. Mem0's answer is
per-user memory (facts keyed to a user_id). Nobody in the map answers it at
the level where companies actually live: **the org** — what it wants, what it
built, whether those still match, and who signed.

**Quire's unheld ground (all shipped or formally designed):**

| Ground | Status | Why the wiki players can't follow cheaply |
|---|---|---|
| Evidence-bound verdicts — every claim resolves to a verbatim quote; UNKNOWN over confidence | shipped (analyzer, fidelity gates) | A wiki "lints for disagreement." A verdict against a signed promise is a different machine. |
| Human-signed authority — approval is the only way anything becomes intent | shipped (approve acts; sessions-as-intent designed) | The article's own limit 3: "incorrect information has the format of correct information." Authority tiers are the cure; they can't be crawled in later. |
| The coupling — what changed × why the author did it × what was promised, on one artifact | shipped (U0 links; review-manuscript design) | Needs session+commit+promise joined at write time. |
| Org-wide, many repos, one queue | shipped (O0/O1: org, paste-a-URL governance) | The quartet are single-corpus tools. |
| Proactive governance — quote-backed alarms, silent on healthy work | shipped (`watch`; Telegram in O5) | A wiki never taps your shoulder. |
| **The owned schema** — a fixed R&D domain topology that ships with the product; slots the model can mechanically verify | shipped as constitution (org-natural-hierarchy, evidence topology); see §1.5 | The quartet's layer 3 is a schema file the CUSTOMER writes. Their success is coupled to each customer's ontology skill; ours is not. |

Also worth stealing from the article: its limit 2 (an early bad summary
poisons every later answer) is exactly what our verbatim receipts fix —
compiled understanding you can audit back to the source. Say that out loud in
sales conversations.

## 1.5 The schema is the top level — the wave's structural weakness (founder refinement, 2026-07-23)

Look again at the article's own three layers. Layer 3 — the schema file,
CLAUDE.md or AGENTS.md — is where all four products quietly hand the hardest
problem back to the customer. **The user defines the schema.** Which means:

- The product's success is coupled to how well each customer authored their
  own ontology and what data they fed it. When an agent wiki works
  brilliantly, it is because someone did a brilliant *custom* job for one
  company. That brilliance is per-company, fragile, and unownable — the
  vendor cannot compound it, cannot compare across it, cannot even take
  credit for it.
- A base LLM maintaining *generic* organization knowledge does not work —
  too many things to decide, too many failure points. The founder's read,
  and ours: when it works, someone did a bespoke schema job for that one
  company.
- Jira fails the same way from the other direction: epics, stories,
  sub-tickets, semantic tags are a user-configurable topology. Every Jira
  instance is a different homemade ontology, poorly defined, unmaintained,
  understood by nobody. The board rots twice — once as status fiction
  (section 2), and once as schema fiction.

**The only tractable path is also the opening: fix the domain.** Quire is
not a generic org-knowledge tool. It is project/product management for R&D
with a strong code focus — and because the domain is fixed, **the schema
ships WITH the product**. Intent → promises → features → work → sessions and
PRs → verdicts. The user never authors an ontology. Every slot is one the
system can fill and *mechanically verify* from the work itself — a promise
has a quote, a verdict has a diff, a session has a transcript. The LLM is
never asked to maintain an open ontology (the thing that fails); it is asked
to maintain slots it can check (the thing that works).

This was already Quire's constitution before the article existed — the
org-natural-hierarchy rule ("top level is derived, not declared; no bare
words; no orphans") and the fixed evidence topology are this exact argument,
recorded weeks ago. The article lets us finally say it as a market claim:
**the wiki players sell you a schema file; we sell you a schema.**

**And: familiar primitives, not a new language.** People have used keyboard
and mouse for fifty years. Tasks broken down from higher intent, PRDs, a
North Star — these are natural and they stay. Epics and stories die (nobody
ever understood them). The product is *the vehicle that brings R&D to a new
age* — new engine, familiar controls. This independently re-confirms two
rulings already made: the familiar app shell, and the CodeRabbit-familiar
wedge.

## 2. The kill thesis, made concrete

The article's deepest sentence is about wikis, but it is really about Jira:
*"The difficult part is the maintenance. This work does not stop. The work
gives no reward. A busy team stops this work first."*

That is why every board becomes fiction. Ticket statuses are hand-maintained
summaries of work — a manual, lagging, lossy projection that nobody is paid
to keep true. The wiki wave fixed this for documents by making the model the
maintainer. **Quire applies the same fix one level up: the board is derived
from the work itself** — sessions, commits, PRs, verdicts — and held against
promises a human signed. Nobody drags a card. The card cannot lie, because it
is computed from evidence and carries its receipts.

The mapping, piece by piece (what a team cancels, and what replaces it):

| Jira/Linear concept | Quire replacement | Status |
|---|---|---|
| Ticket / issue | Feature definition page — derived, living | A1 building now |
| Spec intake / backlog grooming | A conversation becomes signed intent (sessions-as-intent) | O4 designed, ruled into demo |
| Status columns | Verdicts + activity state, computed | shipped |
| Sprint board / my queue | "Needs you" | shipped (A0) |
| Roadmap / Gantt | Timeline perspective over the event river | designed (mock 08) |
| Standup / status report | Today + the morning lede the system writes | shipped |
| Audit trail | The ledger of signed acts | shipped (alignment side) |

**What we deliberately do NOT absorb** (keeps the kill honest): story points
and velocity rituals (agentic orgs measure observed work, not guessed
points); time tracking; Monday's generic non-engineering ops (forms,
marketing calendars) — that is a different animal. The kill target, precisely,
is **Jira/Linear-class engineering PM**. "Kill Monday" is the slogan; the
first corpse is Jira. (⚑ G below.)

**What the buyer must FEEL in the demo:** one moment where work happens and
the board updates itself, with receipts. A PR lands → the feature page, the
timeline, Needs-you, and a Telegram tap all change — and nobody typed a
status. The counter-demo to Jira is the sentence: *"nobody updated this, and
it is true."*

## 3. Cross-company knowledge — two readings, one architecture rule

**(a) Across the whole company.** This is the org platform already in
flight: many repos (shipped), sessions from any agent via the upload envelope
(O3), org channels (O5), one intent surface. Later: non-code sources (design
docs, product docs) — the Personal-Brain move done org-wide, but with
authority tiers instead of flat ingestion. Nothing to decide; keep shipping.

**(b) Across companies.** The horizon play. What could move between orgs:
*patterns, never evidence* — obligation templates by domain ("what payment
features usually promise"), drift classes that precede incidents (we already
have a collision taxonomy), promise-keeping benchmarks. What must never move:
quotes, code, sessions, anything a receipt points at. The defensible version
is only possible BECAUSE of the constitutional machinery: consent-gated,
provenance-preserved, abstractions separable from evidence. Naive
cross-company memory is a privacy catastrophe; ours can be an insurance-grade
data network. Honest sequencing: (b) needs density from (a) first — a
year-class horizon. But the architecture rule costs nothing now and is
existential later: **keep patterns structurally separable from evidence, so
sharing patterns never risks leaking receipts.** (⚑ J below.)

Nobody in the current map can follow here: the wiki quartet is single-corpus,
Mem0 is per-user, and a signed ledger cannot be backfilled — authority
accumulates in time, which makes early signed orgs a moat that compounds.

**The fixed schema is what makes (b) possible at all** (§1.5). Patterns can
only move between companies if the companies are described in the SAME
topology. Jira can never do cross-company benchmarks because every Jira
instance is a different homemade ontology; the wiki players can never do it
because every customer wrote their own schema file. Quire's slots are
identical in every org — a promise is a promise, a verdict is a verdict, a
drift class is a drift class — so patterns are comparable across companies
by construction. The owned schema is not just the tractability answer; it is
the precondition of the network-effect horizon.

## 4. Business framing

**Category.** Reject "org memory" (Mem0 owns the word "memory," one level
down) and "engineering intelligence" (reads as dashboards; that aisle is
boring and owned). The honest frame the article sets up for us: wikis know
documents, memory knows users — **Quire knows the org: what it wants, what it
built, whether they still match, and who signed.** Working category line:
*"the org's living source of truth — derived from the work, signed by
humans."* Marketing spear for the kill: *"Your board is fiction. Quire is
receipts."* And the founder's own line carries the posture for everything we
build and say: **the vehicle that brings R&D to a new age — new engine,
familiar controls.** We never ask a customer to learn a new language (tasks,
PRDs, a North Star stay; epics and stories die) and we never ask them to
write a schema (§1.5). What is new is the engine underneath: derived, not
declared; verified, not asserted; signed, not assumed.

**Who buys, in what order.**
1. **Wedge — eng lead / CTO:** "AI code review that knows your promises."
   CodeRabbit-familiar on purpose (already ruled into A2): the buyer has a
   budget line and a mental slot; we land in it, then show the margin rail
   nobody else can render.
2. **Economic buyer — CEO/founder:** the tap on the shoulder. "Your org broke
   a promise Tuesday 14:02 — here is the quote." That is the demo closer
   (O5/Telegram) and the reason the check gets signed.
3. **Expansion — the PM budget line:** feature pages + timeline + Needs-you
   replace the board; Jira seats become the savings that pay for us.

**Timing winds.** Gist → four products in ~three months means: session
ingestion gets commoditized soon — so the coupling and the signing must be in
the market's head as OURS before the wiki players notice governance. Don't
compete on wiki features (pages, search) — adopt them; the article even hands
us qmd for search. Speed to the first signed orgs beats feature breadth,
because signed history is the one thing a competitor's crawler can't
backfill.

## 5. Implications for current plans (flagged, not edited)

- **Timeline/Gantt slice**: it is the Jira-facing artifact of the kill
  thesis; consider promoting it from A6 into the demo cut (⚑ H).
- **O3 envelope**: emphasize multi-provider from day one — our upload
  standard should be the one other agents adopt before wiki players define
  theirs.
- **PRD v0.3.1 → next revision**: absorb the kill-Jira expansion motion, the
  category line, the cross-company pattern/evidence separation, and reframe
  "journal-as-product" relative to the now-commodity wiki layer — the journal
  is the substrate; **governance is the product**.
- **Cheap wave-rider (post-demo)**: a "wiki export" — serve our compiled
  understanding as plain markdown pages agents expect, backed by our
  receipts. Makes us legible to the agent-wiki ecosystem for near-zero cost.

## ⚑ Founder decisions (revised after the schema refinement)

- **⚑ G — Kill-target precision:** the wedge-kill is Jira/Linear-class
  engineering PM; Monday's generic-ops market is deferred (maybe never).
  Recommend: confirm — and the schema argument (§1.5) upgrades this from a
  wedge choice to the tractability thesis itself: the fixed R&D domain is
  WHY the product can work at all, not just where we enter.
- **⚑ H — Promote the timeline/Gantt perspective into the demo cut** (the
  "board that writes itself" moment). Recommend: yes if it fits the demo
  date; otherwise first slice after. Unchanged by the refinement.
- **⚑ I — Language:** category line "the org's living source of truth —
  derived from the work, signed by humans"; wedge label "AI code review that
  knows your promises"; posture line (founder's own) "the vehicle that
  brings R&D to a new age — new engine, familiar controls"; schema claim for
  technical buyers: "they sell you a schema file; we sell you a schema."
  Recommend: adopt the four-piece kit; reword freely — keep the structure
  (familiar wedge, new category, owned schema).
- **⚑ J — Cross-company architecture rule, adopted now:** patterns must stay
  structurally separable from evidence; nothing evidence-level ever crosses
  an org boundary; consent-gated everything. Recommend: adopt — STRENGTHENED
  by the refinement: the fixed schema is what makes cross-company patterns
  comparable at all, so protecting schema fixedness protects the horizon.
- **⚑ K (new) — The task bridge:** adopt "tasks broken from higher intent"
  as a first-class primitive in the product — familiar vocabulary (task,
  PRD, North Star; never epic/story), new mechanics: a task is born from
  signed intent (proposed by humans or distilled from sessions-as-intent),
  and it CLOSES on evidence, not on a card drag — done when the work proves
  it done, with receipts. This is the concrete bridge that lets a Jira team
  walk over without learning anything new. Product implication: a Tasks slot
  in the schema + a "broken down from" relation to intent, surfacing in
  Needs-you and the feature pages. Recommend: adopt the vocabulary and the
  closes-on-evidence rule now; schedule the primitive as its own slice after
  the demo cut (it must not delay O2–O5).


## ⚑ Rulings — 2026-07-23, all four in

- **G — RULED: Jira/Linear-class engineering PM is the kill target**, as the tractability thesis itself: R&D is the domain whose schema we own.
- **H — RULED: timeline/Gantt joins the demo cut if the schedule holds** — the roadmap-that-updates-itself is the kill beat.
- **I — RULED: the full language kit adopted** (category line, wedge label, "new engine, familiar controls", task/PRD/North-Star vocabulary — never epic/story; tasks born from signed intent, closed on evidence), **with a founder addition that is itself a product principle: the schema is fixed, but AUTHORING within it is first-class.** A PM writing a PRD (or any artifact type the schema allows) is a primary intent path — "we are always there to analyze." Derive-only is wrong; author-then-analyze is equal to derive-then-approve. Authoring surfaces (write a PRD into the schema, have it analyzed into promises) belong in the product alongside the wizard's mining path.
- **J — RULED: patterns-separable-from-evidence adopted as a standing architectural constraint** from this date. Every learned pattern must be structurally separable from org-private evidence.
