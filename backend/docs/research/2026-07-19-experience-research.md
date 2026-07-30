# Quire Experience Research Dossier

**Date:** 2026-07-19
**Brief:** The founder's complaint — the current UI (left-rail map + entity focus screens + ask box) is "still so basic… this should feel like a NEW experience, the semantic nodes and the facts… the language is benign." This dossier hunts named, specific, stealable experience ideas from products, essays, and adjacent domains (genealogy, scholarly editions, aviation, museums, legal tech) where **facts with provenance** is already a solved design problem.

**Quire's objects, for mapping purposes:** *entities* (durable semantic nodes: "Payments", "Feature Resolution"), *promises* (verbatim commitments held by an entity, each with a live health verdict from code checks), *code locations*, *documents/quoted sources*, *relations*, *diffs* (AI-proposed map changes, human approve/reject/teach), *signed decisions* (every fact traces to one).

---

## Part 1 — Making structured knowledge feel alive

### 1.1 The Statement Anatomy — steal Wikidata's claim model wholesale

**Source:** Wikidata — [Help:Statements](https://www.wikidata.org/wiki/Help:Statements), [Help:Qualifiers](https://www.wikidata.org/wiki/Help:Qualifiers), [Help:Ranking](https://www.wikidata.org/wiki/Help:Ranking)

Wikidata is the largest working example of "facts with provenance" as UI. Every statement is `property → value` plus three optional layers: **qualifiers** (scope/context: "as of 2024", "applies to EU checkout"), **references** (collapsible source list under every single claim), and **rank** — *preferred / normal / deprecated*, with preferred shown green and deprecated shown red. The rank system means superseded facts are **kept and displayed, not deleted** — a deprecated statement with a reference is information, not garbage.

**Maps to Quire:** A promise is a statement. Give it the full anatomy: the verbatim quote is the value; qualifiers carry scope and effective date; references are the quoted source + signed decision; rank is *current / superseded / retired*. When a promise is renegotiated, the old wording drops to deprecated rank and stays visible in the entity's record. This single move kills "benign" — every fact on screen visibly carries its own paper trail and status, like Wikidata but designed well (Wikidata's own [UI redesign input page](https://www.wikidata.org/wiki/Wikidata:UI_redesign_input) admits their rendering is clumsy — the model is the steal, not the pixels).

### 1.2 Fact-Bound Evidence — Ancestry's "source per fact, not per profile"

**Source:** Ancestry — [Managing Facts, Events, and Sources in Trees](https://support.ancestry.com/s/article/Managing-Facts-Events-and-Sources-in-Trees?language=sv); Evidence Explained's [QuickLesson 26 on Ancestry citations](https://www.evidenceexplained.com/content/quicklesson-26-thinking-through-an-ancestry.com-citation); [MyHeritage on citing sources](https://education.myheritage.com/article/citing-genealogy-sources-why-how-to-add-source-citations/)

Genealogy UIs learned the hard way that citations attached to a whole person are worthless; the working pattern is **citation attached to the individual fact** (this birth date, this burial place), with a **confidence field** and a recorded date, and one source citable across many facts/people. A person's profile is a list of facts, each expandable into its evidence.

**Maps to Quire:** This is Quire's exact schema — but the stealable *experience* detail is the genealogist's emotional loop: an **unsourced fact looks naked**. Render promises without a check or a quoted source in a visibly "undocumented" state (hollow chip, dotted underline) so the absence of evidence is itself a visual event. Also steal the many-to-many move: one signed decision or document radiating to every promise it supports, navigable in both directions.

### 1.3 Variants In Situ — the critical apparatus, but clickable

**Source:** Digital scholarly editions — [Digital Latin Library guidelines](https://digitallatin.github.io/guidelines/LDLT-Guidelines.html), [Beyond Variants: Digital Desiderata for the Critical Apparatus](https://books.openedition.org/obp/3421?lang=en), [TEI Critical Apparatus](https://www.tei-c.org/release/doc/tei-p5-doc/en/html/TC.html)

Classicists publish texts where every disputed word carries an *apparatus criticus* — a compressed note of variant readings from different manuscripts and who chose what. The digital versions add the killer mechanic: **variant readings can be swapped into the text in situ** so the reader evaluates alternatives in place, with margin icons expanding into the full apparatus, and variant types filterable.

**Maps to Quire:** A promise's wording history is a set of variant readings. On the entity page, a small margin mark (⌘ apparatus glyph) on any promise with history; clicking it lets you **swap the superseded wording into place** — see what we used to promise, in the same visual position, with the "witnesses" (PRD v2, the 2025 decision, the Slack quote) listed like manuscript sigla. This is the most Quire-native idea in the whole dossier: your product is literally a critical edition of the org's intent.

### 1.4 The Content Is The Type — Tana supertags

**Source:** Tana — [Supertags](https://tana.inc/supertags), [Supertags docs](https://tana.inc/docs/supertags)

Tana's insight: a tag isn't a label *about* a thing, "the content **is** the tag" — `buy milk` *is a* `#task`, and applying the supertag instantly gives the node a typed template of fields. Everything sharing a supertag becomes a live collection viewable as a table, with inheritance between parent and child tags.

**Maps to Quire:** Entities and promises should behave like supertagged nodes: `#promise` implies fields (verbatim text, source, check, verdict, signer); `#entity` implies (promises, locations, relations, documents). The stealable experience is the **instant pivot**: any typed thing can be flipped into a live table of all its siblings ("every promise with a failing verdict, as a table") without leaving the map. That gives the founder a second demo view for free — the same facts, re-projected — and makes the ontology feel like a living instrument rather than a filing scheme.

### 1.5 Connections, Not Likes — every relation is an authored act

**Source:** Are.na — [Connections help doc](https://help.are.na/docs/getting-started/connections), [Fast Company on Are.na's philosophy](https://www.fastcompany.com/90232953/why-were-building-a-social-network-supported-by-people-not-advertisers)

Are.na has no likes; its atomic social gesture is the **connection** — placing a block into a channel — and every connection records *who* connected it and *when*. Meaning accrues by recontextualization: the same block sitting in three channels has three layers of authored meaning, and navigation is "traversing connections."

**Maps to Quire:** Never render a relation as a bare line/label. Every edge in Quire's map is an authored, signed act: "*Payments — depends on — Ledger* · connected by the collation of 2026-06-12, approved by Dana." Relations get hover provenance like facts do (see 2.2). This is cheap to build (you already have signed decisions) and it's exactly the "non-benign" texture the founder wants: the map stops being a diagram and becomes testimony.

### 1.6 The Object Biography — museum accession records as entity pages

**Source:** Cooper Hewitt — [collection site](https://collection.cooperhewitt.org/), [Cooper Hewitt Labs](https://labs.cooperhewitt.org/); Rijksmuseum object pages (deep-zoom + provenance chains)

Museum digital catalogs treat each object as a **specimen with an accession record**: an ID, a provenance chain (who owned it, when, how it arrived), physical description, related objects, exhibition history. Cooper Hewitt's experimental pages are famous for making metadata itself the aesthetic object — the label *is* the design.

**Maps to Quire:** Restyle the entity focus screen as an **accession record**: a typographic "specimen label" header (entity name, accession date = first observed, steward = owning team), then provenance chain (the decisions that shaped it), then holdings (promises), then related objects. The museum register also gives you honest language for uncertainty: "attributed to," "provenance unknown," "on loan" — see Part 4.

### 1.7 Reactive Recomputation Made Visible — Observable's aliveness

**Source:** Observable — [Reactive dataflow](https://observablehq.com/@observablehq/learning-observable-reactive-dataflow), [observablehq.com](https://observablehq.com/)

Observable notebooks feel alive because cells **visibly re-evaluate** when a dependency changes, spreadsheet-style — the reader watches consequences propagate. The aliveness isn't decoration; it's the system showing its own causality.

**Maps to Quire:** When a check re-runs (a commit lands, a verdict flips), don't just swap a badge — let the change **ripple visibly**: the verdict chip pulses once, the entity's health line in the left rail updates a beat later, dependent relations flash their re-evaluation. One choreographed propagation per real event (never ambient animation) makes "live health verdicts from code checks" *feel* live, which is currently pure claim. Pairs with 3.1's discipline: motion only when the world actually changed.

---

## Part 2 — Interaction patterns for node+evidence worlds

### 2.1 Sliding-Pane Evidence Trails — Andy Matuschak's stacked notes

**Source:** [notes.andymatuschak.org](https://notes.andymatuschak.org/) (note the `?stackedNotes=` URLs — the trail is literally serialized in the address bar); commentary: [Commune on Matuschak's notes](https://devonmeadows.com/notes/andy-matuschaks-notes/)

Clicking a link doesn't navigate away — it **pushes a new pane onto a horizontal stack**, previous panes collapsing to labeled spines at the left. Your exploration path stays visible and physically ordered; you can scroll back through how you got here; the whole trail is a shareable URL.

**Maps to Quire:** This is the answer to "how do I follow an evidence chain without a graph canvas." Promise → click its check → check pane stacks to the right → click the quoted source → source pane stacks → click the signing decision → decision pane stacks. Four panes = one complete provenance chain, side by side, each collapsed pane a labeled spine (nice quire resonance: a shelf of spines). The serialized-trail URL means an evidence chain becomes a **pastable artifact** for Slack/PRs — enormous for a trust product. Top-tier demo material.

### 2.2 The Provenance Hover-Card — Perplexity's citation chips + Wikipedia previews

**Source:** Perplexity — [AI UX Playground teardown](https://aiuxplayground.com/teardowns/perplexity/output/), [citation case study](https://www.aiuxplayground.com/gallery/perplexity-citations/); pattern survey: [AI citation UI patterns](https://www.aydesign.ai/blog/ai-citation-source-ui-patterns-2026)

Perplexity "treats citations as the product": inline numbered chips, domain labels tying every claim to its origin, a Check Sources affordance on any selection. The teardown literature's key finding: inline, hoverable citations **reframe the user from passive consumer to active verifier** because verification cost drops to near zero.

**Maps to Quire:** Every fact-atom (promise verdict, relation, field value) gets a hover-card with a fixed three-line grammar: **Quoted source** (the verbatim excerpt, styled as a quotation), **Signed by** (person + decision + date), **Checked** (check name, last run, verdict). Same card everywhere — in the entity page, in ask-box answers, in diffs. The ask box especially must answer *only* in chips that carry these cards; that's what makes Quire's answers different in kind from a chatbot's.

### 2.3 The "Why?" That Actually Answers — Ironclad Jurist's explanation triple

**Source:** Ironclad — [AI contract review](https://ironcladapp.com/product/review-contracts), [Jurist redlining with playbooks](https://ironcladapp.com/resources/articles/jurist-redlining-playbooks), [Legal Dive on GPT-3 redlining](https://www.legaldive.com/news/gpt-3-contracting-openai-ironclad-ai-assist/642429/)

Ironclad's AI redlines every clause with a structured explanation: **what changed, why it matters, and how the suggestion resolves the detected problem** — sourced against the firm's *playbook* (intended positions) and *precedent* (what was actually accepted in past deals), both shown next to the clause.

**Maps to Quire:** Every verdict and every AI-proposed diff gets a `Why?` affordance that expands to exactly that triple: *what the check observed* (with the failing code location), *which promise it contradicts* (verbatim), *what would resolve it*. And steal the playbook/precedent split for teaching: when a human rejects a diff and teaches, that teaching becomes a visible "position" the AI must cite next time ("proposed despite position P-14 because…"). Teaching stops being a black box and becomes visible jurisprudence.

### 2.4 Suggestions In The Body, Not In A Queue — Google Docs suggesting mode

**Source:** Google Docs — [Suggest edits](https://support.google.com/docs/answer/6033474?hl=en&co=GENIE.Platform%3DDesktop); [How-To Geek walkthrough](https://www.howtogeek.com/788621/how-to-track-changes-in-google-docs/)

Docs' great trick over GitHub PRs: suggestions live **inside the living document**, green insertions and struck deletions rendered in place, each with a margin card carrying author, rationale, and one-tap ✓/✗. The reader never leaves the artifact to review changes to it; the document and its proposed future coexist.

**Maps to Quire:** Render AI map-diffs **on the entity page itself**: a proposed new promise appears in the promises list in "suggestion green" with strike-through on wording it replaces; a proposed relation appears in the relations block, tentative. Margin card = the AI's Ironclad-style rationale + Approve / Reject / Teach. A separate diff-review screen can exist for bulk triage, but the demo moment is *the map wearing its proposed future in place*. (Legal redlines — [contract redlining software](https://ironcladapp.com/journal/contract-management/contract-redlining-software) — are the serious-register visual language for this: strikethrough + underline, not GitHub's red/green blocks.)

### 2.5 Branch Review as Before/After Worlds — Figma branching

**Source:** Figma — [Guide to branching](https://help.figma.com/hc/en-us/articles/360063144053-Guide-to-branching), [Review branch changes](https://help.figma.com/hc/en-us/articles/5693123873687-Review-branch-changes), [Branching best practices](https://www.figma.com/best-practices/branching-in-figma/)

Figma's branch review shows changes as **side-by-side or overlaid before/after canvases**, not textual hunks — reviewers see the two worlds. Branches also serve as a *contribution* channel: non-editors propose library changes as branches, "much like a pull request," conversation attached.

**Maps to Quire:** For multi-entity diffs (the AI restructures a neighborhood: splits an entity, moves three promises), single-line suggestions aren't enough — show **"map as it is / map as proposed"** as two synchronized focus views with changed elements highlighted. Also steal the contribution framing: any human can open a proposed change to the map (not just the AI), reviewed through the identical approve/reject/teach machinery — the map becomes a commons with a constitution.

### 2.6 Prompted Focus — Kumu's answer-sized map slices

**Source:** Kumu — [Focus guide](https://docs.kumu.io/guides/focus), [Tour](https://kumu.io/tour); [RJI on Kumu for storytelling](https://rjionline.org/news/systems-mapping-for-storytelling-tips-for-using-kumu/)

Kumu's *focus* temporarily hides everything except selected elements + N degrees of connection; *prompted mode* goes further — the user starts from **a search prompt and the map materializes only what answers it**, unveiling the network step by step. Their storytelling guides insist: never open on the full map; reveal.

**Maps to Quire:** This is the ask box's destiny. A question shouldn't return a text answer with links — it should **materialize a scoped slice of the map**: the 2 entities, 3 promises, 1 failing check that constitute the answer, each element carrying its provenance hover-card, with a "widen by one degree" affordance. The answer *is* a temporary, saveable gathering of the map (see 4.1 — call it exactly that). No canvas required: the slice renders as a structured dossier page.

### 2.7 Scrub The Living Record — time as a first-class control

**Source:** [tldraw timeline scrubber example](https://tldraw.dev/examples/timeline-scrubber); [VS Code file-history scrubber proposal](https://github.com/microsoft/vscode/issues/261695) (video-player-style scrubber with real-time content updates while dragging, markers for major changes); [Revision History replay for Google Docs](https://chromewebstore.google.com/detail/revision-history-writing/dlepebghjlnddgihakmnpoiifjjpmomh)

The emerging pattern for living documents: a horizontal scrubber like a video player — drag and the artifact itself re-renders at that moment, with tick-marks for significant events.

**Maps to Quire:** Put a scrubber on the entity page. Dragging it re-renders the *whole record* as of that date: which promises existed, their wording then, verdicts then, relations then — with tick-marks at signed decisions and verdict flips. "When did this promise start failing, and what did we believe when we made it?" becomes a physical gesture. This is Quire's structural advantage (every fact already traces to dated decisions) turned into the most demoable interaction in the product. Pairs with 1.3: scrubbing is variants-in-situ along the time axis.

### 2.8 Stable Geography Instead Of A Canvas — Muse's stable layout + Kinopio's spatial memory

**Source:** Muse/Ink & Switch — [Muse: designing a studio for ideas](https://www.inkandswitch.com/muse/) (stable layout is what makes in-place annotation possible); Kinopio — [kinopio.club](https://kinopio.club/), on placing ideas to "build up your own spatial memory… the magic that makes big ideas easier to recall"

The spatial-tools lesson worth keeping even under a canvas ban: **memory is spatial, so layout must be stable**. Muse can support durable ink annotations only because content never reflows; Kinopio's whole value is that *where you put a thing* becomes how you remember it.

**Maps to Quire:** Entity pages must have a fixed, invariable anatomy — promises always in the same zone, relations always in theirs, checks in theirs — so a returning user's eye lands by habit ("failing verdicts live top-right"). Same for the left rail: **stable, curated order (steward-pinned), never re-sorted by algorithm**. Spatial memory without a canvas is achieved through typographic geography — like a newspaper, where sports is always in the back.

### 2.9 Answer In Their Order — Stripe's progressive disclosure

**Source:** Stripe — [docs.stripe.com](https://docs.stripe.com/); teardowns: [Moesif](https://www.moesif.com/blog/best-practices/api-product-management/the-stripe-developer-experience-and-docs-teardown/), [Mintlify on Stripe docs](https://www.mintlify.com/blog/stripe-docs)

Stripe's docs define each concept **in one sentence inline at first mention** (no tab-switching), and lay out pages "so a developer's questions get answered in the order they ask them, not in the order the internal product hierarchy would suggest."

**Maps to Quire:** Sequence the entity page by the reader's question order: (1) *what is this and is it healthy?* (2) *what exactly did we promise?* (3) *says who?* (4) *where's the code?* (5) *what's it connected to?* — not by database table. And define Quire's own nouns inline on first hover, in one authored sentence each (see Part 4), so the vocabulary teaches itself.

---

## Part 3 — Motion & materiality: making health/verdicts feel physical

### 3.1 The Quiet-Dark Panel — aviation's status language

**Source:** Dark cockpit philosophy (Airbus A320 onward) — [Airflow blog](https://www.airflow.blog/2025/01/16/the-dark-cockpit-philosophy-enhancing-efficiency-and-safety-in-modern-aviation/), [Skylegs](https://www.skylegs.com/news/2017/11/dark-cockpit-philosophy), [flightcrew alerting design paper](https://www.researchgate.net/publication/345092209_Flightcrew_Light_Alerting_Design_with_Dark_Cockpit_Philosophy)

In a dark cockpit, **a system working normally shows nothing** — no green lights, no "OK" badges. An annunciator that is lit *means something*, and color is a strict severity grammar (amber = caution, red = warning). The panel's silence is the good news.

**Maps to Quire:** Today's dashboards drown in green checkmarks; Quire should be a dark cockpit. Healthy promises: quiet ink, **no badge at all**. A verdict annunciator lights only on caution (check stale, source unverified) or warning (promise broken). The left-rail map becomes an annunciator panel: a wall of calm names, and the one amber entity is *instantly* the whole story. Add a "master caution" strip at the top of the rail (aviation's single summarizing light) that appears only when something below is lit. This is the cheapest, deepest fix for "benign" — it makes *silence itself* mean "all promises hold," which is a product claim rendered as design.

### 3.2 One Accent As Flashlight — Linear's restraint + speed-as-material

**Source:** Linear — [How we redesigned the Linear UI](https://linear.app/now/how-we-redesigned-the-linear-ui); analyses: [LogRocket on "Linear design"](https://blog.logrocket.com/ux-design/linear-design/), [925 Studios breakdown](https://www.925studios.co/blog/linear-design-breakdown-saas-ui-2026), [Sequoia spotlight](https://sequoiacap.com/article/linear-spotlight/), [performance.dev teardown](https://performance.dev/how-is-linear-so-fast-a-technical-breakdown)

Why Linear reads premium: near-black surfaces, paper-white type, **one high-contrast accent used sparingly as a "functional flashlight" to signal action**; components "precision-machined" with no decorative ornament; and speed as a material — <100ms view transitions, instant issue creation ("design speed makes the path to each interaction short"). Saarinen: "If I'm building a house, I don't want my tools to be fun. I want them to be good."

**Maps to Quire:** Adopt the discipline, not the palette: exactly one accent, reserved for **the act of deciding** (approve/sign affordances), never for chrome. Verdict colors (3.1's amber/red) are the only other hues. And treat latency as materiality: entity pages and hover-cards must land instantly or the "living map" claim dies — a slow provenance card feels like an excuse, a 50ms one feels like the system *knew*.

### 3.3 The Check Receipt — ledger skeuomorphism at the evidence layer only

**Source:** Receipt/ledger aesthetic — [Figma on skeuomorphism](https://www.figma.com/resource-library/what-is-skeuomorphism/), thermal-receipt web artifacts ([print-receipt example](https://github.com/parzibyte/print-receipt-thermal-printer)); register: court filing stamps, notarial seals, library due-date slips

Skeuomorphism works when the borrowed object carries the right *social contract*. Receipts, ledgers, and stamps are civilization's oldest verdict-materiality: monospace, timestamped, itemized, initialed.

**Maps to Quire:** Give each check run a **receipt**: a narrow monospace slip — check name, commit hash, timestamp, observed values, verdict — visually distinct (subtle perforation rule, tabular figures) from the surrounding prose UI. Approvals get a **stamp**: when a human signs a diff, a compact date-stamp mark ("APPROVED · 2026-07-19 · D.K.") is impressed next to the fact with a single 150ms settle animation — the one deliberately physical gesture in the product (cf. Family's principle that a state change should "visually organize itself into place," [benji.org/family-values](https://benji.org/family-values) — steal the fluid state-transition, reject the playful register). Restraint rule: receipts and stamps appear **only** at the evidence layer, never as ambient decoration — that's the difference between a courthouse and a theme restaurant.

### 3.4 Density Done Right — Bloomberg's temporal density + purpose-built type

**Source:** Bloomberg — [How Terminal UX designers conceal complexity](https://www.bloomberg.com/company/stories/how-bloomberg-terminal-ux-designers-conceal-complexity/); Matt Ström-Awn, [UI Density](https://mattstromawn.com/writing/ui-density/)

Two lessons from the terminal: (a) real density is **temporal** — the Terminal wins because everything loads instantly, letting a skilled user traverse dozens of views in seconds; (b) Bloomberg commissioned Matthew Carter to cut custom fonts *with finance-specific glyphs* (1/64th fractions) — the type itself speaks the domain.

**Maps to Quire:** Design a tiny set of **verdict glyphs** — purpose-built marks for holds / caution / broken / unverified / superseded — used identically at every zoom level (rail, page, hover-card, ask answer), with tabular-nums for all counts (per [Vercel's Web Interface Guidelines](https://vercel.com/design/guidelines)). A proprietary status glyph set is a cheap way to make Quire's screens recognizably *Quire* in a screenshot — the way a Bloomberg screen is unmistakable.

### 3.5 Deep-Link Everything — addressability as craft

**Source:** Vercel — [Web Interface Guidelines](https://vercel.com/design/guidelines): "Deep-link everything — filters, tabs, pagination, expanded panels"; Matuschak's `?stackedNotes=` URLs (2.1)

The guideline sounds mundane; for a provenance product it's foundational. Every promise, verdict, receipt, diff, and evidence *trail* gets a stable URL.

**Maps to Quire:** Facts you can't link to are facts you can't cite. When every verdict is pasteable into a PR review or a Slack argument ("we can't ship this — [quire link] Payments still promises idempotent retries"), Quire's map starts doing rhetorical work *outside* its own UI — which is how a system of record actually wins an org.

---

## Part 4 — Voice & naming: mining the quire

**Bookbinding sources:** [Etherington & Roberts dictionary — "quire"](https://cool.culturalheritage.org/don/dt/dt2766.html); [Section (bookbinding), Wikipedia](https://en.wikipedia.org/wiki/Section_(bookbinding)); [Quires and quire signatures](https://mouse.digitalscholarship.nl/lessons/quires-and-quire-signatures); [Univ. of Nottingham, Forming quires](https://www.nottingham.ac.uk/manuscriptsandspecialcollections/researchguidance/medievalbooks/quires.aspx); [CCAHA book terminology guide](https://ccaha.org/sites/default/files/attachments/2018-05/Illustrated%20Guide%20to%20Book%20Terminology%20Part%20One.pdf)

A quire is a gathering of folded sheets sewn as a unit; the craft vocabulary is a nearly complete, historically honest lexicon for Quire's objects:

### 4.1 The Working Lexicon (proposal)

| Bookbinding term | Craft meaning | Quire meaning |
|---|---|---|
| **Gathering** | sheets folded and sewn as one unit | a saved slice of the map — an ask-box answer, a review packet, a demo dossier ("save this as a gathering") |
| **Leaf** | one folio, two sides | a promise — and the two sides write themselves: **recto** = the intent (verbatim promise), **verso** = the implementation (code locations + checks). "Both sides of the leaf agree" = healthy; "the verso contradicts the recto" = drift |
| **Signature** | the mark on a gathering's first leaf used to collate the book correctly | a human sign-off — the pun is exact and load-bearing: in bookbinding a signature *is* the mark that guarantees correct assembly. "This fact carries three signatures." |
| **Collation** | checking that every gathering is present, complete, and in order | **the AI's review cycle** — a proposed map-diff batch is "a collation"; approving it is "collating the map." (Bibliographers literally write collation formulas asserting a book's completeness — this is Quire's diff, 500 years early.) |
| **Colophon** | the note at a book's end recording who made it, where, when | the provenance block on every fact/entity — rename the metadata footer "colophon" |
| **In quires** | printed but not yet bound | AI-proposed facts awaiting approval — "still in quires" = unbound, unratified |
| **Foliation** | numbering the leaves | stable IDs/permalinks for promises (leaf 14 of Payments) |

Voice rule: use this vocabulary **sparingly and structurally** — object names and actions, never whimsy ("collate" as the approve-all verb: yes; "welcome to your cozy book nook": never). Two or three terms deep is a language; ten is a costume.

### 4.2 Authored, Verb-First, Matter-of-Fact — the copy register

**Sources:** Linear — [Startups, Write Changelogs](https://linear.app/now/startups-write-changelogs) (the changelog as authored narrative artifact, tone matched to a serious audience); Stripe — verb-first headings, one-sentence inline definitions, errors that state the fix ([Moesif teardown](https://www.moesif.com/blog/best-practices/api-product-management/the-stripe-developer-experience-and-docs-teardown/)); iA — "a scalpel in a world of Swiss army knives" ([ia.net/writer](https://ia.net/writer)); Vercel guidelines — active voice, numerals not words

What makes copy feel authored vs. template: it takes a position, uses domain-precise nouns, and states consequences. Applied to Quire's surfaces:

- **Verdict lines are declarative sentences with evidence**, not labels. Benign: "Status: failing." Authored: "*Payments promises idempotent retries. `RetryWorker.process` stopped guaranteeing this on May 12 (commit 8f3c2a1).*" The fact does the talking; the tone is a court reporter, not a mascot and not a scold.
- **Empty states are honest inventories**: "No signatures yet. Every fact here is still in quires." (One sentence, states the stakes, teaches a term.)
- **The AI speaks as a clerk proposing, never asserting**: "I read PRD §4 and propose two leaves for *Feature Resolution*. Neither is signed." Modality discipline — *observed / proposed / signed* as the product's three verb moods — is the single strongest voice move for a trust product.
- **A public "Collation Log"** (changelog of the map itself, in Linear's authored-changelog spirit): weekly, human-readable — "This week the map gained 3 entities and lost 1 illusion." That last register — dry, slightly literary, evidence-backed — is Quire's voice found.

---

## Part 5 — Seductive but wrong (and what to do instead)

1. **The global graph canvas.** Banned by the PRD, and the evidence agrees: past ~200 nodes the force-directed view is "visually impressive and navigationally useless" — the hairball ([Code Culture on Obsidian's graph view](https://codeculture.store/blogs/developer-culture/obsidian-graph-view-useful)). It demos once and then decorates. **Instead:** Kumu-style *prompted focus slices* (2.6) for the "show me" moment; a **one-hop "Nearby" panel** on every entity (typed relation list with provenance, like Roam's tidily-ordered page graph); sliding-pane trails (2.1) for traversal; stable page geography (2.8) for spatial memory. Relationships feel spatial through *consistent typographic place*, not floating dots.
2. **The infinite whiteboard** (Heptabase/Muse/Kinopio). Right for one person's thinking, wrong for an org's shared record — freeform placement makes *someone's* mess everyone's map, and undermines "every fact traces to a decision." **Instead:** steal only their stable-layout/spatial-memory lesson (2.8) and let *gatherings* (4.1) be the bounded, curated "boards."
3. **Playful delight aesthetics** (Family's warmth, Kinopio's confetti). Wrong register for signed facts and broken promises. **Instead:** steal Family's *fluidity* — one perfect state-change animation (the stamp, 3.3) — inside Linear's sobriety.
4. **Green-checkmark wellness dashboards / health scores.** A "94% aligned" number is confident and unfalsifiable — the opposite of Quire's epistemics. **Instead:** dark-cockpit silence (3.1) plus enumerable verdicts ("2 promises broken, 1 unverified" — each word a link).
5. **Chat-first everything.** A chat transcript is where provenance goes to die; answers scroll away and can't be cited. **Instead:** the ask box *materializes gatherings* (2.6) — durable, addressable, evidence-chipped pages.
6. **Full-costume skeuomorphism** (leather, paper grain, page-turn sounds). The quire metaphor should live in *language and structure* (signatures, collation, colophons), with exactly one physical gesture (the stamp). Material honesty beats theme-park bookbinding.

---

## Top 10 for a founder demo (ranked by expected impact)

1. **Quiet-Dark Annunciator Map** (3.1, dark cockpit) — the rail goes silent-when-healthy; one amber entity becomes the whole story. Reframes the product's core claim as a visual law; cheapest big win.
2. **Suggesting-Mode Map Diffs** (2.4, Google Docs + legal redline) — the AI's proposals rendered in-place on the entity page in redline, with approve/reject/teach in the margin. The approval loop becomes visceral instead of administrative.
3. **Sliding-Pane Evidence Trails** (2.1, Matuschak) — promise → check → source → decision stacked side by side, trail serialized in the URL. The "every fact traces" claim, walkable in four clicks.
4. **The Statement Anatomy** (1.1, Wikidata) — promises with qualifiers, mandatory references, and preferred/superseded/retired rank; superseded wordings kept visible. Turns "benign facts" into evidentiary claims.
5. **Time Scrub on the Entity Record** (2.7) — drag a scrubber, the whole entity re-renders as of that date, tick-marks at decisions and verdict flips. Unique to Quire's data model; jaw-drop moment.
6. **The Check Receipt & Signature Stamp** (3.3) — monospace receipts for check runs, a date-stamp that physically settles on approval. Verdicts get mass; the one skeuomorphic gesture.
7. **The Quire Lexicon** (4.1) — leaves (recto=intent, verso=implementation), signatures, collation, colophon, "in quires." Kills "the language is benign" at the root, and the signature/collation puns are structurally exact.
8. **Ask Box → Materialized Gatherings** (2.6, Kumu prompted focus) — answers arrive as scoped, saveable map slices with provenance chips, not chat text.
9. **The Provenance Hover-Card + "Why?" Triple** (2.2 + 2.3, Perplexity + Ironclad) — one fixed grammar (quoted / signed / checked) on every fact everywhere; every verdict expandable to what-changed/why-it-matters/what-resolves.
10. **Linear Restraint + Verdict Glyphs + Deep Links** (3.2, 3.4, 3.5) — one accent reserved for the act of signing, a proprietary status-glyph set, every fact addressable. The craft substrate that makes 1–9 read as premium instead of clever.

---

### Source index (primary)

- Andy Matuschak's notes — https://notes.andymatuschak.org/
- Wikidata Help: Statements / Qualifiers / Ranking — https://www.wikidata.org/wiki/Help:Statements · https://www.wikidata.org/wiki/Help:Qualifiers · https://www.wikidata.org/wiki/Help:Ranking
- Ancestry, Managing Facts/Sources — https://support.ancestry.com/s/article/Managing-Facts-Events-and-Sources-in-Trees?language=sv · Evidence Explained QuickLesson 26 — https://www.evidenceexplained.com/content/quicklesson-26-thinking-through-an-ancestry.com-citation
- Digital Latin Library guidelines — https://digitallatin.github.io/guidelines/LDLT-Guidelines.html · TEI Critical Apparatus — https://www.tei-c.org/release/doc/tei-p5-doc/en/html/TC.html · Beyond Variants — https://books.openedition.org/obp/3421?lang=en
- Tana Supertags — https://tana.inc/supertags · https://tana.inc/docs/supertags
- Are.na Connections — https://help.are.na/docs/getting-started/connections · Fast Company — https://www.fastcompany.com/90232953/why-were-building-a-social-network-supported-by-people-not-advertisers
- Cooper Hewitt collection & Labs — https://collection.cooperhewitt.org/ · https://labs.cooperhewitt.org/
- Observable reactive dataflow — https://observablehq.com/@observablehq/learning-observable-reactive-dataflow
- Perplexity citation teardowns — https://aiuxplayground.com/teardowns/perplexity/output/ · https://www.aiuxplayground.com/gallery/perplexity-citations/
- Ironclad Jurist — https://ironcladapp.com/product/review-contracts · https://ironcladapp.com/resources/articles/jurist-redlining-playbooks
- Google Docs Suggest edits — https://support.google.com/docs/answer/6033474
- Figma branching — https://help.figma.com/hc/en-us/articles/360063144053-Guide-to-branching · https://help.figma.com/hc/en-us/articles/5693123873687-Review-branch-changes
- Kumu Focus — https://docs.kumu.io/guides/focus · https://kumu.io/tour
- tldraw timeline scrubber — https://tldraw.dev/examples/timeline-scrubber · VS Code scrubber proposal — https://github.com/microsoft/vscode/issues/261695
- Muse / Ink & Switch — https://www.inkandswitch.com/muse/ · Kinopio — https://kinopio.club/
- Dark cockpit — https://www.airflow.blog/2025/01/16/the-dark-cockpit-philosophy-enhancing-efficiency-and-safety-in-modern-aviation/ · https://www.skylegs.com/news/2017/11/dark-cockpit-philosophy
- Linear redesign & analyses — https://linear.app/now/how-we-redesigned-the-linear-ui · https://blog.logrocket.com/ux-design/linear-design/ · https://sequoiacap.com/article/linear-spotlight/ · https://performance.dev/how-is-linear-so-fast-a-technical-breakdown · changelogs — https://linear.app/now/startups-write-changelogs
- Bloomberg Terminal UX — https://www.bloomberg.com/company/stories/how-bloomberg-terminal-ux-designers-conceal-complexity/ · Matt Ström-Awn, UI Density — https://mattstromawn.com/writing/ui-density/
- Vercel Web Interface Guidelines — https://vercel.com/design/guidelines
- Family design values — https://benji.org/family-values
- Stripe docs teardowns — https://www.moesif.com/blog/best-practices/api-product-management/the-stripe-developer-experience-and-docs-teardown/ · https://www.mintlify.com/blog/stripe-docs · iA Writer — https://ia.net/writer
- Obsidian graph-view critique — https://codeculture.store/blogs/developer-culture/obsidian-graph-view-useful
- Bookbinding terminology — https://cool.culturalheritage.org/don/dt/dt2766.html · https://en.wikipedia.org/wiki/Section_(bookbinding) · https://mouse.digitalscholarship.nl/lessons/quires-and-quire-signatures · https://www.nottingham.ac.uk/manuscriptsandspecialcollections/researchguidance/medievalbooks/quires.aspx
