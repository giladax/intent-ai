# Web App Recreation — current understanding, in a familiar shell

> **For agentic workers:** execute slice-by-slice (subagent-driven-development), each app slice PAIRED with its backend O-slice (docs/plans/2026-07-22-org-platform.md) so the demo path never stalls. Implementers use the frontend-design skill; this plan gives the design brief, not pixel specs (briefs-leave-room). Mocks in `mockups/` (real data, rendered PNGs) are the visual contract — **mock + render BEFORE any build; the founder reacts to renders.**

**Goal:** Recreate `app/` ground-up as the org platform's face. The product is **current understanding** — how we develop, how we review, what IS going on — served to humans AND agents, pivotable by perspective (a feature's definition, the org over time, what needs you now).

**Architecture:** Same substrate (Vite/React in `app/`, FastAPI JSON + SSE, StaticFiles in prod, dev proxy). Real URL routing (Telegram deep links, shareable reviews). **The app is a renderer over contracts:** every view is a clean URL backed by the same JSON endpoints agents use — no private data paths, ever. Room-by-room transition: new shell first, old surfaces mounted under routes, replaced slice by slice.

## Founder summary (read this, skip the rest)

The app looks like the tools your team already knows — a left-hand tree (your org, its repos, their features), a list in the middle, the details on the right — like GitHub or Jira, not like a newspaper. What's different is what's IN it: every review carries the promises it touched with the receipts; every change can carry the session that reasoned it; every approval is your signature. Two places anchor daily life: **"Needs you"** (the few things awaiting your call — quiet when the org is fine) and **Overview** (what is going on — pivot it by feature, by repo, by time). Ask "what IS this feature now?" and there's a page that answers. Ask "what's moving across the org this month?" and there's a timeline. Same understanding, different angles.

## Design rulings (founder, 2026-07-22 evening — supersede ⚑E below)

1. **Familiar shell.** Hierarchical left-nav + list + detail pane (GitHub/Jira/CodeRabbit-class chrome). No invented UX metaphors at the shell level. The SUBSTANCE stays ours: verdicts with verbatim receipts, "reasoned in session" notes, the signing act, promise lamps.
2. **Plain language everywhere.** Simplest words, first-read clear for non-native speakers: "Needs you" (not Docket), "Breaks a promise" (not contradicts intent), "No promise covers this" (not uncovered surface / POSSIBLE_DRIFT), "Why the author did it" (not declared intent). Every label gets this sweep; classification enums stay internal.
3. **Perspective pivots are the product.** ONE evidence-bound understanding, many angles: the **Feature definition page** (what this feature IS now — definition, constraints, evidence, open reviews, sessions), the **org timeline/Gantt** (what's moving, when, across repos and features), **Today/Overview** (current state, not an edition), the review flow, the develop flow (what to pick up next). Any node kind can be top-level; Feature is the common default.
4. **Humans AND agents.** The same views are addressable and structured: clean URLs, and the JSON contract behind every view is a public API an agent can call. The app renders understanding; it never owns it.

## Information architecture

```
Left nav (always):  Needs you (badge) · Features · Repositories · Reviews · Sessions · Journal · Channels
Left tree (below):  repositories ▸ their features (status dots) — the org's hierarchy, expandable

/                        Today / Overview — what is going on now; pivot: by feature · by repo · by time (Gantt)
/needs-you               The few decisions awaiting you: breaks, approvals, drafts, not-covered calls
/feature/<id>            FEATURE DEFINITION — what it is now, its promises (lamps), evidence, open reviews, sessions
/repo/<ws>               Repo page — features, promises, reviews, sessions of one repo
/repo/<ws>/review/<n>    REVIEW — diff with inline promise notes + rail: verdict sentence, receipts, "why the author did it", your call
/timeline                The org over time — features/repos as swimlanes (Gantt perspective)
/sessions  /session/<id> Upload desk + session detail (narrative, moments, evidence — carries over)
/journal                 The river + lenses (carries over)
/correspondence          Chat (page + dock everywhere)
/channels                Telegram config, test send
```

Mocks (the visual contract, real data): `mockups/04-app-shell.html` (shell + Needs-you), `05-feature-detail`, `06-daily-home`, `07-hierarchy-lenses`, `08-feature-timeline`, `09-review` — PNGs in `mockups/shots/`.

**Review page grammar** (mock 09): CodeRabbit-familiar — file diffs in the center with **inline note cards anchored to lines** (promise verdicts + session quotes, verbatim-verified), and a right rail: what the review found (plain sentence + chips) → promises checked (receipts) → the gap → why the author did it (session, "attached by trailer") → your call (Draw the missing promise & sign / Wave it through / Send back). The full line-anchored annotation engine is A6; A2 ships file-level notes with the same chrome.

**Kill / keep / transform (unchanged from the first draft except the shell):** keep Correspondence, river+lenses, session detail/evidence walk, feed CONTENT (lede/trending feed the Today view); transform FeaturesPage→Feature definition page, ReviewQueue→Needs-you/Reviews; kill lens-chat-as-landing, DigestPanel; intent ledger stays server-rendered + linked for the demo, absorbed at A6.

## What survived from Broadsheet (the substance, re-homed)

Receipts as first-class UI (quote blocks with source footnotes) · "Reasoned in session…" (now an inline note + rail card, plain-worded "Why the author did it") · the signing act (buttons say what they do: "Sign", "Send back") · promise lamps · verdict color semantics (green=kept, red=broken, amber=drift/not-covered, gray=unknown — uncertainty stays gray, not colorful) · sentences first, ids as footnotes.

## Tech & structure

react-router; `app/src/shell/` (nav/tree/list/detail chrome), `app/src/surfaces/<name>/`, `app/src/api/` typed client per FastAPI contracts (org card API from O0 is the first). The 8 util test files carry; component tests rewritten with their rooms. Every surface's data contract documented in the router docstrings (agents consume the same JSON — ruling 4).

## Slices (each pairs with a backend O-slice; demo cut order)

Gates per slice: **[APP]** build + typecheck + vitest · **[PY]** backend suite untouched-green · **[DEMO]** founder-visible render/screenshot. Every slice starts from its mock; deviations go back through a render.

### A0 — Shell + Needs you + Today (pairs O0)
The familiar shell (mock 04): left nav + tree from O0's org API, "Needs you" list + detail pane (Docket API — plain-language labels), Today/Overview v1 (mock 06; feed lede/trending as content). Old surfaces mounted under routes; lens-chat landing retired. Done when: founder opens `/` and recognizes the app instantly, sees real repos/features in the tree.

### A1 — Add a repo + Feature definition (pairs O1)
Paste-URL flow in familiar chrome (scan → draft cards → Approve = sign), repo appears in the tree; **Feature definition page** (mock 05) served from real feature data. Done when: founder adds a repo and opens a feature's definition.

### A2 — Review page v1 (pairs O2)
Mock 09 live: repo page + review with diff, file-level inline promise notes, the rail (verdict sentence, receipts, gap, your call). Done when: a real PR's review reads plainly with receipts on demand.

### A3 — Sessions + "why the author did it" (pairs O3)
Upload desk (envelope, as_intent toggle), session notes appear on reviews (inline + rail), correlation proposals into Needs-you. Done when: founder uploads the session behind a PR and its reasoning shows on the review.

### A4 — Intent approvals in Needs-you (pairs O4)
Intent cards from as_intent sessions; signing writes the memo artifact; the feature definition page shows the new signed intent. Done when: a product-direction session becomes signed intent on screen.

### A5 — Channels + deep links (pairs O5)
`/channels` (Telegram token/chat, test send); alarms deep-link to the exact review. Done when: the Telegram tap lands on the review page.

### A6 — Post-demo: perspectives + the annotation engine
The org **timeline/Gantt** (mock 08) as an Overview pivot · line-anchored diff annotations (the full engine behind mock 09's inline notes) · intent-ledger absorption · ops/Quality disposition.

## ⚑ Founder decisions

- **⚑ E — Design direction: SUPERSEDED 2026-07-22 evening.** The original ruling (Broadsheet & Marginalia, confirmed earlier the same day) was REVERSED by the founder on seeing the mockups: "it's more about current understanding… should make sense — how do we develop, how do we review, what is going on — in a nice way." New rulings 1–4 above govern. The Broadsheet mocks were removed from `mockups/` (git history holds them at commit 524016c); its design section is preserved below as history.
- **⚑ F — Landing: REVISED with E.** The landing is **Today/Overview** (the what-is-going-on view), not the broadsheet Front Page. Correspondence stays one click away + dock.

## Superseded: the Broadsheet & Marginalia direction (history, 2026-07-22 morning)

Kept for the record — the first recreation design evolved the journal-era ink system into "the org's standing record": the org home as a newspaper front page (masthead, lede, repos as columns), PR review as a marked-up manuscript with serif marginalia in the margin rail, approvals as stamps. Rejected because it traded FAMILIARITY for distinctiveness at the shell level — no hierarchy, no recognizable navigation, harder first-read. Its substance (receipts, session marginalia, signing, ink semantics) survived into the familiar shell above. Mocks: `git show 524016c -- mockups/`.

## Demo script skeleton (what the founder says, screen by screen)

1. **Today:** "This is my org right now — what moved today, what's being reviewed, what the system noticed. Not a report someone wrote; the current understanding, live."
2. **The tree / add repo:** "Here are my repos and their features. Adding one is pasting a GitHub URL — it reads the repo, drafts its promises, and I sign. Nothing governs without a signature."
3. **Review:** "Every PR is checked against our promises. This one adds behavior no promise covers — there's the note on the exact lines, and the receipt. Plain words, real quotes."
4. **Why the author did it:** "Our agents ship their sessions with their code. Here's the author's own reasoning, verified word-for-word against the transcript."
5. **Feature definition:** "Ask what anything IS right now — this feature's definition, its promises, its evidence, what's open against it. One page, always current."
6. **Session as intent:** "This session isn't code — it's me thinking product with an agent. I upload it as intent, sign two cards, and the next PR is judged against what I said this morning."
7. **The tap:** *(phone buzzes)* "And when a promise breaks, it taps me on the shoulder — with the quote — and the link drops me on the exact review."
