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

Also worth stealing from the article: its limit 2 (an early bad summary
poisons every later answer) is exactly what our verbatim receipts fix —
compiled understanding you can audit back to the source. Say that out loud in
sales conversations.

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

## 4. Business framing

**Category.** Reject "org memory" (Mem0 owns the word "memory," one level
down) and "engineering intelligence" (reads as dashboards; that aisle is
boring and owned). The honest frame the article sets up for us: wikis know
documents, memory knows users — **Quire knows the org: what it wants, what it
built, whether they still match, and who signed.** Working category line:
*"the org's living source of truth — derived from the work, signed by
humans."* Marketing spear for the kill: *"Your board is fiction. Quire is
receipts."*

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

## ⚑ Founder decisions

- **⚑ G — Kill-target precision:** the wedge-kill is Jira/Linear-class
  engineering PM; Monday's generic-ops market is deferred (maybe never).
  Recommend: confirm.
- **⚑ H — Promote the timeline/Gantt perspective into the demo cut** (the
  "board that writes itself" moment). Recommend: yes if it fits the demo
  date; otherwise first slice after.
- **⚑ I — Language:** category line "the org's living source of truth —
  derived from the work, signed by humans"; wedge label "AI code review that
  knows your promises." Recommend: adopt; reword freely — the two-layer
  structure (familiar wedge, new category) is the part to keep.
- **⚑ J — Cross-company architecture rule, adopted now:** patterns must stay
  structurally separable from evidence; nothing evidence-level ever crosses
  an org boundary; consent-gated everything. Costless today, existential
  later. Recommend: adopt as a standing constraint.
