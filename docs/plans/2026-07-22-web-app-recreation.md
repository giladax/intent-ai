# Web App Recreation — the platform's face: Broadsheet & Marginalia

> **For agentic workers:** execute slice-by-slice (subagent-driven-development), each app slice PAIRED with its backend O-slice (docs/plans/2026-07-22-org-platform.md) so the demo path never stalls. Implementers use the frontend-design skill; this plan gives the design-system brief and layout grammar, not pixel specs (briefs-leave-room). Founder mandate: **"Let it be creative. I want us to be different — this is an opportunity."** Distinctiveness is a goal, not a risk.

**Goal:** Recreate `app/` ground-up as the org platform's face — org front page, paste-a-URL onboarding, PR review with promise-anchored annotations, session upload, intent approvals, channels — in a design language nobody else has, while carrying forward the surfaces that already earn their place.

**Architecture:** Same substrate (Vite/React in `app/`, FastAPI JSON + SSE, StaticFiles in prod, dev proxy). New: real URL routing (deep links are load-bearing — Telegram alarms in O5 link into a specific review), a named design system extracted into components, and a room-by-room transition (new shell first, old surfaces mounted under routes, replaced slice by slice — recreation without a big-bang cutover).

## Founder summary (read this, skip the rest)

The new app opens on your org's **Front Page** — a real masthead, the morning lede the system wrote about your work, and every repo as a standing column. Adding a repo is pasting a URL and signing what it promises. A PR opens as a **marked-up manuscript**: the verdict in a sentence, and in the margin — where red ink has always lived — the promises it touches, the receipts, and "Reasoned in session…" from the agent that wrote it. Approvals happen at one **Inbox** desk, because in this product a human signature is the only source of authority. When a promise breaks, Telegram taps you and the link drops you on the exact annotated review. Two decisions are yours (⚑ E–F).

## The design language: Broadsheet & Marginalia (⚑ E)

The current app's "Ink & Paper" editorial system (serif mastheads, mono chrome, six semantic inks, ledger rows, stamps) is already distinctive, founder-shaped, and semantically load-bearing. The recreation **pushes it further instead of sideways** — from "newspaper" to **the org's standing record: a broadsheet whose documents you annotate**:

- **The front page is a real front page.** Masthead, lede (the Python feed's editorial IS the copy), repos as column items with standing — not cards in a grid, columns in a paper.
- **Marginalia is the interaction metaphor** — and OUR diff differentiation. CodeRabbit writes AI comments on diffs; we write **margin notes anchored to promises**: obligation verdicts as stamps, receipts as footnotes, the coupled session's reasoning as marginalia in the consult ink. The margin rail is where the product's soul (quote-backed judgment) becomes visible.
- **Signatures are the authority act, visually.** Approve surfaces (wizard, intent cards, proposals) render as signing — stamp + name + date. "Machines propose, humans approve" becomes something you can see.
- **Ink semantics extend to verdicts** (implementers refine, meanings are ruled): moss=ALIGNED/kept, red=OFF_INTENT/hard-rule/break, gold=POSSIBLE_DRIFT (something noticed), ink-soft gray=UNKNOWN (uncertainty is honest, not colorful), teal=decisions/commitments, violet=pivots. Sentences first; ids and shas are literally footnotes.
- **Typography:** Newsreader serif for editorial voice, mono for chrome/data/diffs. The serif-marginalia-on-mono-diff contrast is the signature image. No generic SaaS fonts, no dark-glass defaults.
- **System components** (extracted to `app/src/ink/`): Masthead, ColumnItem, Stamp, MarginNote, Receipt (quote + source footnote), Lamp (obligation status), SigningBlock, WireRow (river entries), ManuscriptFrame (the review layout). Implementers own their internals; names and meanings are the contract.

Alternative considered and not recommended: the austere mono "instrument panel" direction from `backend/design/round*` (Meridian) — strong, but less differentiated (many tools are mono-austere) and it abandons the six-ink semantics the journal era already taught the founder's eye. The broadsheet direction is the creative bet that is also the incumbent's evolution.

## Information architecture

```
/                     Front Page — masthead, lede, repos as columns, wire (latest river)
/repo/<ws>            Repo desk — promises w/ lamps, open reviews, coupled sessions, checks timeline
/repo/<ws>/review/<n> THE REVIEW MANUSCRIPT — verdict head · manuscript body · margin rail   ← the differentiator surface
/sessions             Sessions — upload desk (envelope, as_intent toggle) + list
/session/<id>         Session detail — narrative, moments, evidence walk (carries over)
/inbox                The Inbox — ALL approval acts: observations, intent cards (O4), correlation proposals (O3)
/journal              The river + lenses (Features are lenses here — not a top-level section)
/correspondence       The Correspondence (full-page chat; also a dock everywhere)
/channels             Channels — Telegram config, test send (O5)
```

**The Review manuscript layout grammar (reserved NOW, filled by slices):** three zones — (1) **verdict head**: one sentence ("Keeps 4 promises, may break 1 — review required") + stamps; (2) **manuscript body**: the change itself — v1 ships changed-files + behavioral delta prose; the **diff pane slots here later** (A6) with obligation-anchored line annotations, CodeRabbit-class rendering, our marginalia; (3) **margin rail**: promise verdicts with receipts, "Reasoned in session…" notes, footnotes. The grammar (split body/rail, anchor points per file/hunk) is structural from A2 so the diff pane arrives without relayout.

**Kill / keep / transform:**
- **Keep** (carry forward): ChatDock/Correspondence, JournalPage river + lens mechanics, SessionsPage/SessionDetail/EvidenceWalk/ProvenancePanel, NotifButton, feed content (moves to Front Page).
- **Transform:** FeaturesPage/FeatureDetail → lenses inside /journal (journal-as-product ruling: Features are lenses, not a nav section); ReviewQueue → Repo desk + manuscript; feed page → Front Page lede/trending.
- **Kill:** lens-chat as the LANDING (⚑ F — Front Page is the landing; Correspondence one click away); DigestPanel (its endpoint is deprecated); Quality page retires to an ops corner or dies (implementer judgment at A6, report it).
- **Alignment server-rendered pages** (wizard HTML, intent ledger, mirror, inbox): the add-repo flow gets a NEW SPA surface at A1 (the wizard's engine serves it via O1's API); the **intent ledger stays server-rendered and linked** from the repo desk for the demo (honest scope), absorbed post-demo (A6+).

## Tech & structure

- **Routing:** adopt react-router (URLs are product surface now: Telegram deep links, shareable reviews). Old useState view-switching dies with the shell.
- **Structure:** `app/src/ink/` (design system), `app/src/surfaces/<name>/` (one dir per route surface), `app/src/api/` (typed client per FastAPI contracts — O0's org endpoint schema is the first; SSE consumption for chat/streams as today).
- **Transition:** room-by-room — A0 ships the new shell + Front Page with old surfaces mounted under their new routes; each subsequent slice replaces a room. The old app is never dual-maintained; there is no fallback path (the founder ruled recreation; git history is the fallback).
- **Tests:** the 8 util test files carry as-is; component tests are rewritten with the rooms they cover; each slice's gate includes app vitest + typecheck + build.

## Slices (each pairs with a backend O-slice; demo cut order)

Gates per slice: **[APP]** build + typecheck + vitest green · **[PY]** backend suite untouched-green · **[DEMO]** founder-visible proof (screenshot).

### A0 — The new shell + Front Page (pairs O0)
`app/src/ink/` extraction, react-router shell, Front Page consuming O0's org endpoint + feed lede/trending, wire column from the journal API. Old surfaces mounted at their routes; lens-chat landing retired (⚑ F). Done when: the founder opens `/` and sees the org's front page with the dogfood repos as columns.

### A1 — The signing desk: add-repo flow (pairs O1)
Paste-URL surface, scan/draft progress read from O1's API, draft obligation cards, the **SigningBlock** Approve act, repo appears on Front Page. Done when: founder pastes a URL and signs a repo into governance without leaving the app.

### A2 — Repo desk + Review manuscript v1 (pairs O2)
`/repo/<ws>` desk (promises+lamps, reviews, sessions, ledger link-out) and the manuscript with verdict head + margin rail + changed-files body (diff pane slot reserved, empty state honest). Done when: a real PR's verdict reads as a marked-up page with receipts on demand.

### A3 — Session upload + marginalia (pairs O3)
Upload desk (envelope fields, drag transcript, as_intent toggle), "Reasoned in session…" margin notes on reviews, correlation proposals into /inbox. Done when: founder uploads the session behind a PR and its reasoning appears in the margin.

### A4 — The Inbox intent approvals (pairs O4)
Intent cards from as_intent sessions at the Inbox, SigningBlock approval → memo artifact visible on the repo desk; next review cites it. Done when: a product-direction session becomes signed intent on screen.

### A5 — Channels + deep links (pairs O5)
`/channels` config (Telegram token/chat, test send), alarm messages deep-link to `/repo/<ws>/review/<n>`. Done when: the Telegram tap lands the founder on the exact annotated review.

### A6 — Post-demo: the annotated diff pane + absorptions
The full diff surface (per-hunk rendering, obligation-anchored line annotations, session marginalia at line level — the CodeRabbit-class pane with our soul), intent-ledger absorption into the desk, Quality/ops disposition. Named now so the grammar reserved in A2 is honored.

## ⚑ Founder decisions

- **⚑ E — Design direction: "Broadsheet & Marginalia"** (evolve the ink system into the platform's record-and-annotation language) — recommended with conviction; the alternative austere-mono direction is documented above and not recommended.
- **⚑ F — The Front Page replaces lens-chat as the landing** (Correspondence stays one click away + dock everywhere) — recommended.

## Demo script skeleton (what the founder says, screen by screen)

1. **Front Page:** "This is my org's front page. Every repo, every promise, and this morning's lede — written by the system, about our own work, with receipts."
2. **Add repo:** "Adding a repo is pasting a URL. It reads the repo, drafts the promises it finds — and I sign. Nothing governs this org without a human signature."
3. **Review manuscript:** "Every PR is read against our promises. This one keeps four and may break one — there's the margin note, and there's the receipt: the quote from the code against the promise it collides with."
4. **Coupled session:** "Our agents ship their sessions with their code. Here's WHY the author did it — its own reasoning, in the margin. Reasoned in session; receipts on demand."
5. **Session as intent:** "This next session isn't code — it's me thinking product with an agent. I upload it as intent, sign two cards, and the org's contract just grew. The next PR is judged against what I said this morning."
6. **The tap:** "And when a promise breaks, I don't find out in a dashboard." *(phone buzzes — quote in Telegram)* "It taps me on the shoulder, and the link drops me on the exact page."
