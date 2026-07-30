# The Org Platform — Experience & Design

**Date:** 2026-07-22 · **Status:** Design definition (no code) · **Author:** Fable
**Grounded in:** `docs/plans/2026-07-22-org-platform.md` (slices O0–O6, rulings A–D), `docs/plans/2026-07-22-web-app-recreation.md` (Broadsheet & Marginalia, rulings E–F), `mockups/01-front-page.html` + `mockups/02-review-manuscript.html`, the O0 code (`backend/quire/db/org_models.py`, `org_store.py`, `org_router.py`), the wizard engine (`onboard.py`), alarms (`alarms.py`), the GitHub adapter, and the coupling contract (U-plan). All rulings honored; deviations raised as open questions, never made silently.

This document defines **what the founder sees and does** — the experience — plus enough of the how to build it in slices. Part I–III are the experience, in plain language. Part IV is "how it's built" and can be skipped. Part V is the build order. Part VI is the short list of decisions only the founder can make.

---

## Part 0 — Positioning: the surface pushes you to act, not to read

*(Added 2026-07-22 after the founder's rethink: "a 'read' feels fluff and cheap … rethink given our true competitors like CodeRabbit and Obsidian.")*

**Quire is not a newsletter and not a notes app. It is a standing record of your org's promises that *governs the work and hands you the decisions only a human can make* — every one quote-backed and one tap from done.** Against **CodeRabbit**, whose AI reviews are per-PR line nits you read and forget: Quire reviews each PR against *signed org-level intent*, cites the *session reasoning that wrote the code*, and — when intent breaks — *comes to you* with the exact broken promise and the one fix, instead of waiting in a comment thread for you to scroll. Against **Obsidian**, a second brain you hand-tend and must remember to open: Quire's understanding is mechanically bound to evidence, cross-examinable down to a quote, and it *pushes the decision to the person who can act* rather than sitting in a vault waiting to be visited.

**The load-bearing consequence — a design principle for every surface below:** the north star is *propagate the reasoning and the most relevant **decision** to the person who can act.* So every Quire surface is a **desk of things awaiting your judgment**, not a **paper you passively read**. A surface earns its place only if it carries a decision with a **verb** — *sign this, fix this, approve this, send it back* — or the receipts you need to make one. Anything that reads as a summary you consume and move past is fluff, and gets cut or reframed into an action. This does not discard the Broadsheet & Marginalia language (founder-ruled E/F) — the manuscripts, the marginalia, the receipts, the signing ceremony are *all* actionable and all kept. It sharpens it: the newspaper *voice* stays; the newspaper *posture* (skim-and-set-down) goes.

### The two poles — the Docket (push) and the Feature Overview (pull)

The product is coherent only when both are present, and they are *not* in tension — they answer two different intents:

1. **The Docket (push) — "what needs me now."** Decisions that come to you, ranked by stakes, silent when the work is healthy. It leads the landing when something wants your signature; it is the phone tap.
2. **The Feature Overview (pull) — "what's going on with everything."** The place you *actively visit* to check the live state of a feature — its promises, their fate (kept / drifting / broken / recovered), its alignment, the sessions that touched it — every line drillable to the quote. Derived from what the code did, never a status anyone typed.

The push/pull line is exactly what keeps "an overview" from becoming the fluff we cut: a **summary pushed to your phone** is passive and stays cut; an **overview you pull** — cross-examinable to evidence, computed not typed — is the org's memory *made browsable*, and it is core value. Feature is the primary lens today (per `CLAUDE.md`: *"Feature is the primary lens"*) and the demo's lens; the vision doc generalizes the Overview to *any perspective* over the same graph (spend, risk, people) — but the demo cut ships the **Feature** lens, concrete and buildable.

---

## Part I — The demo path, as the founder lives it

Six beats. Each one: what you SEE, what you DO, what the system does behind the curtain.

### Beat 1 — You open your org. It leads with what needs your judgment.

**You see:** The **Front Page**, and the first thing it does is *point at what wants you*. A masthead — *Quire*, "Intent · Implementation · Alignment" — then, in the lede position where a paper prints its headline, **The Docket**: the decisions awaiting your signature, loudest first, each a sentence with a verb.

> **1 promise broken — awaiting your signature.** *refund-agent* raised its refund cap to **$100** while the guard still holds at **$50**. Sign the risk or send it back → *(the quote is right here)*
> **2 obligations drafted — awaiting your signature.** *acme/billing* finished reading; its contract is drafted and parked → open it
> **3 intent cards distilled — awaiting your signature.** from this morning's product session → review them

If the Docket is empty, it *says so and stays quiet* — *"Nothing needs you right now. The org is holding its promises."* — the same discipline as the alarms channel: silent when the work is healthy, never manufacturing a "read" to fill space.

Below the Docket, the standing record: every repository as a **column** — name in serif, a verdict badge (*Aligned* in moss, *Partial* in gold, *Quiet* in gray), one sentence of standing, and a footer of small figures (open reviews, sessions coupled, `ws/refund-agent` as a footnote). A column is not a headline to read; it's a door — click it and you're at that repo's desk, mid-decision. (The composed narrative "lede" and "trending" don't vanish — they move to `/journal`, one click away, where reading *is* the point. See Part I‑A on what happened to the morning paper.)

Nothing here asks you to learn notation. Every line reads as a sentence; ids are in the footer, in nine-point mono.

**You do:** Act on the top of the Docket — or, if it's empty, glance at the standing columns and move on. You never *read the org*; you *clear its decisions*.

**Behind it:** `GET /api/org` composes the repo columns (O0, already shipped). The Docket is a new composition over the same evidence — open reviews awaiting signature (alignment store), parked repo drafts and intent cards (`OrgStore`) — sorted by the alarm policy's own severity ranking so the Front Page and the phone agree on what matters. No content the founder must read; only decisions they can take.

### Beat 2 — You paste a URL. The system reads the repo and drafts its promises. You sign.

The hero moment. Full detail in Part II; the shape:

**You see:** In the last cell of the repo columns, a **quiet door**: *"Bring a repository under governance. + Add a repository."* Clicking it opens the **Signing Desk** — a single-page flow with four acts printed like a table of contents: **It reads · It drafts · You sign · First results.**

**You do:** Paste `https://github.com/acme/refund-agent`. Watch the system work — live, narrated ("Reading the repository… 214 files · Found 6 documents that speak in promises… · Drafting the contract…"). Review the **draft promise cards** — each a plain statement with its verbatim quote from the repo's own documents. Strike the ones that are wrong, edit wording if you like, and **sign**. The signing block is a real one: your name, your role, a signature line, a date stamp.

**Behind it:** URL → shallow mirror clone → the existing wizard engine (`scan_intent_sources` ranks documents by promise density; `propose` mines obligation cards with verbatim provenance) → your approval writes the workspace (`sources.yaml` marked `approved`, stable obligation ids minted) → `list_prs` pulls recent PRs and replays a few through the analyzer so first results appear in the same sitting. **This is where org understanding is born, and the design treats it as the product's soul: the machine proposes, and nothing governs your org without your signature.**

### Beat 3 — Its pull requests start arriving reviewed. On GitHub, and here.

**You see:** Two surfaces, same verdict.

On **GitHub** (public, and deliberately so — founder-ruled 2026-07-22): a comment on the PR, posted by Quire, that reads as a verdict sentence — *"Keeps three promises, may break one — a human must sign."* — followed by the findings with their quotes. It updates in place as the PR changes; it never stacks duplicates. This is a review a contributor *acts on* — it names the promise at risk and quotes the collision — not a pile of line nits to scroll past.

On the **Front Page**: the repo's column updates its standing — the verdict badge flips, the sentence changes, the open-review count ticks. Click through and you're on the **Review Manuscript**: the verdict head in large serif (*"Keeps three promises, may break one"*), the changed files as a manuscript body, and — in the margin, where red ink has always lived — the promises this page touches: a gold *◈ Possible drift* stamp with the receipt quoted from the code (`if amount > 50: raise RefundRejected`), a moss *✓ Aligned* note where a promise held, a gray *? Unknown* where honesty requires it ("No test exercises this — we cannot say kept, only unverified").

**You do:** Nothing. That's the beat: a PR opened on a governed repo gets its verdict with no human action.

**Behind it:** A sync loop polls each governed repo for new/updated PR heads (`PrEventSource` seam — webhooks slot in later behind the same event shape), analyzes each against the signed contract, publishes the marker-upserted comment via the existing adapter, emits a `check:analyzed` event onto the journal river. (Slice O2.)

### Beat 4 — You upload the session that wrote the PR. The margin gains the author's own hand.

**You see:** The **Sessions desk**: an upload surface shaped like an envelope — drop the transcript, address it (repo, and optionally the PR or commits it belongs to), post it. Then, on the review manuscript, a new kind of margin note in consult blue: **⌁ Reasoned in session** — *"Raising the cap for the premium tier — tiers.py handles routing, so the guard shouldn't see these amounts. Leaving it as-is."* — the author's own reasoning, quoted verbatim, with the session id as a footnote. The GitHub comment gains the same sentence: *"Reasoned in session 7680a08… — receipts on demand."*

If you didn't address the envelope, the system proposes the match itself — as a sentence in your **Inbox**: *"Session 5b31a1bb edited 4 of this PR's 6 files during its commit window. Couple them?"* Proposals never self-approve.

**You do:** Drag a `.jsonl` transcript, pick the repo, optionally attach the PR number. Or accept a proposed match in the Inbox.

**Behind it:** The coupling contract (O3): the transcript is persisted FIRST (sha256-verified archive + `session_uploads` row — customer evidence never lost, even if digestion fails), then digested by the existing pipeline, then matched by fixed precedence: explicit attach → `Claude-Session:` commit trailers → structural correlation as *proposals only* (no content similarity, per ruling). This envelope is the **standard**: any agent — Claude Code today, others later — complies by producing the envelope, not by imitating anyone's log format.

### Beat 5 — A session that isn't code becomes intent. You sign two cards; the org's contract grows.

**You see:** The same upload envelope with one more line: a checkbox, plainly worded — **"This session carries intent"** (product direction, not code). Upload it, and your **Inbox** receives **intent cards**: statements the system distilled from your own conversation, each with the verbatim quote from the transcript ("premium refunds must always route through a human above $200"). The same signing block as onboarding.

**You do:** Sign the cards that are truly promises. Edit or strike the rest.

**Behind it:** The constitutional mechanism (O4): approval writes a session-memo artifact into the workspace's approved intent sources; the session itself never gains authority — it stays observed evidence and the receipts. The next PR is judged against what you said this morning, and the verdict cites the memo.

### Beat 6 — A promise breaks. Your phone buzzes. The quote is in the message.

**You see:** On your phone, in Telegram:

> 🔴 **CRITICAL** — refund-agent broke 2 days ago — and no one is watching.
>
> refund-agent carries "Automated refunds must not exceed $50." That promise broke in PR 47 (cap raised to $100 while the guard still holds at $50), and in the 14-day window not one message landed on it — the only thing that touched it was the change that broke it. If this change is intended, sign it; if not, it needs an owner now.
>
> *Receipts:* signed OB-REFUND-001 · check PR 47 · coverage 14d window
>
> **Open the review →**

The link drops you on the exact annotated manuscript — the gold stamp, the receipt, the signing block waiting for your name.

**You do:** Tap the link. Sign the risk or send it back. The tap on the shoulder replaced the dashboard.

**Behind it:** The alarms policy is already built and already composes this exact message (`alarms.py::render_telegram`) — deterministic, quote-backed, silent on healthy work, deduped so the same break never re-pages. Slice O5 is *delivery only*: a `Channel` protocol carries the composed message to the Telegram channel you registered (Part III), and records the delivery so dedup survives restarts.

---

## Part I‑A — What happened to the "morning paper" (the rethink, applied)

The founder's instinct was right: a **Digest / newsletter you read** looks like fluff next to the tap that makes you act. So the framing is corrected, without throwing away the substance the founder ruled in (Broadsheet & Marginalia, E/F):

- **The Front Page no longer leads with a paper to read.** It leads with **The Docket** — decisions awaiting your signature. The composed narrative (the "morning lede", trending) is *not deleted* — it moves to **`/journal`**, where reading is a deliberate act you choose, not the thing that greets you. The journal is the org's memory and the place you go to *understand*; the Front Page is where you go to *act*.
- **"Digest" as a channel purpose is cut** (details in Part III). A daily read pushed to your phone is exactly the cheap-newsletter posture the founder flagged. What replaces it, if anything: an optional **"Anything waiting?" tap** — a once-a-day message *only when the Docket is non-empty*, and it is a **queue of decisions with verbs**, not a summary. It says *"3 things want your signature"* and links to the Docket. If nothing's waiting, it stays silent. (Open question 3 lets the founder turn even this off — the alarm channel may be the only channel that should ever buzz.)
- **Everything that survives is actionable or evidentiary.** The manuscripts (a verdict you sign), the marginalia and receipts (the evidence you cross-examine before signing), the signing ceremony (the act itself), evidence-on-demand — all kept, all carry a verb or back one. Nothing survives whose only job is to be skimmed.

This is the CodeRabbit / Obsidian line drawn through every surface: **CodeRabbit hands you comments to read; Obsidian hands you a vault to tend; Quire hands you decisions to make, and comes to you when one can't wait.**

---

## Part II — Add a repository: the Signing Desk

The founder's immediate question, answered in full. This flow is where org understanding is born — the design gives it ceremony without friction.

### The door

On the Front Page, the last cell in the repository columns is not a card but a **door**: small kicker ("The Hero Flow" in the mockup; production copy: *"New resident"*), an italic line — *"Bring a repository under governance."* — and the CTA. The same CTA repeats smaller in the section rule ("Repositories under Governance · **+ Add a repository**"). One click opens `/add-repo`.

### The four acts (one page, progressing top to bottom)

The desk is a single tall page in the Broadsheet voice — not a modal, not a step-carousel. Each act prints beneath the last, like a form being filled in ink. You can always see what came before.

**Act 1 — The address.** One field: *"Paste the repository's address."* Accepts `https://github.com/owner/name`, `github.com/owner/name`, or `owner/name`. On submit, the system echoes back what it understood — *"acme/refund-agent — public repository, 214 files, last pushed yesterday"* — before doing anything heavy. Instant validation errors live here (see states below).

**Act 2 — It reads.** A narrated progress ledger, line by line as work completes, mono type like a wire feed:

```
07:41:02  Fetched the repository            214 files
07:41:05  Read 41 documents                 6 speak in promises
07:41:09  Ranked the intent sources         docs/PRD.md leads (score 8.4)
07:41:16  Drafted 7 promise cards           every one carries its quote
```

The founder confirms which documents count as intent — the system leads with its ranked picks pre-selected ("These six documents look like where your promises live — confirm or adjust"), each with a one-line preview. The customer confirms; they don't hunt.

**Act 3 — You sign.** The draft contract, as cards. Each card:

- **The statement, first and largest** (serif): *"Automated refunds must not exceed $50."*
- **The receipt beneath it** (collapsed, one click): the verbatim quote and its source — *— docs/PRD.md § Refund policy*.
- **Three quiet controls:** keep (default), edit the wording, strike.

At the bottom, the **SigningBlock** — the same visual act as the review manuscript's: *"Awaiting the signature of — Gilad Koch, Founder · reviewer of record"*, a signature line, and the button: **✓ Sign the contract**. Above it, one honest sentence: *"Seven promises will govern acme/refund-agent. Machines proposed them; your signature is what makes them true."*

**Act 4 — First results.** Signing doesn't end at a success toast — it ends at value. The system pulls the repo's recent PRs (or, if it has none, replays its recent commits as reviews) and shows the first verdicts *on this same page* as they complete: *"PR 47 — Keeps three promises, may break one → read the manuscript."* The founder leaves the desk having already seen their new contract catch something — or hold clean.

Then the Front Page has a new standing column.

### States (the repo's life, visible everywhere as one word)

| State | Founder sees | Meaning |
|---|---|---|
| `scanning` | Column appears immediately, grayed, with a live line: *"Reading the repository…"* | Mirror + scan running |
| `drafting` | *"Drafting its promises…"* | Obligation mining running |
| `awaiting_signature` | Gold-edged column: *"7 promises drafted — awaiting your signature."* Click returns to Act 3. | The draft is parked; nothing governs yet. Draft artifacts never reach the analyzer. |
| `active` | A full standing column | Signed. Reviews run. |
| `watched` | A quiet column: *"Under watch — no promises yet. Give it its first one."* | Signed in with no obligations (founder-ruled: no dead-ends). PRs are recorded and land on the desk; verdicts wait on a contract. |
| `error` | Red-edged note in plain words + a "try again" | See errors below |
| `fixture` / `frozen` | As today (O0) | Seeded residents keep their meanings |

A parked draft is durable — close the tab mid-flow, the column waits on the Front Page with its state, and the Inbox lists it too (the Inbox is where ALL approval acts wait).

### Errors, in plain words

- **Bad URL:** inline, immediate, before any work: *"That doesn't look like a GitHub repository address. It should read github.com/owner/name."*
- **Repository not found or private:** *"GitHub wouldn't show us acme/refund-agent. It may be private — for now Quire governs public repositories; private ones arrive with the GitHub App."* (Ruling C: personal token + public repos for the demo.) If a token exists but lacks access, same sentence, honest cause.
- **Already a resident:** *"acme/refund-agent already lives here — its column is on the Front Page."* Link to it.
- **No promise-bearing documents found:** not an error and never a dead-end (founder-ruled 2026-07-22 — "no dead-ends"). An honest Act 2 result that itself becomes an action: *"We read 41 documents and found no promises we'd stake a signature on. Sign it in as a **resident under watch** — its PRs will be recorded on your desk, and its contract can grow the moment you give it one (a session-as-intent is the fastest way)."* The signing block still appears — you sign it into residency — and the repo's first standing note is itself a decision that lands on the Docket: *"acme/tooling — no promises yet. Give it its first one → "*. The door never refuses.
- **No PRs and shallow history:** Act 4 says so plainly and replays what commits exist; a repo can enter governance before its first PR.
- **Scan failure mid-flight:** the narrated ledger prints the failing line in red with a retry; the transcript of what succeeded is kept.

### The resident's card, once home

The standing column (already ruled in the mockups) carries: name · verdict badge (*Aligned / Partial / Quiet*) · one-sentence standing lede · an italic margin-note line (the most recent thing worth saying, in the ink of its meaning) · footer: open-review lamp, sessions-coupled figure, `ws/<name>` footnote. New from this design: during onboarding the same column shape carries the state line, so "adding" and "resident" are one continuous surface, not a wizard that vanishes.

---

## Part III — Add a channel: where the org can reach you

Ruling A: **Telegram first** — bot token + chat id, zero OAuth. Slack later, same shape.

### The surface

`/channels` — a short page titled in the Broadsheet voice: **"Where the org can reach you."** Under it, registered channels as ledger rows, and one door: **+ Connect a channel.**

### The connect flow (three acts, zero jargon)

**Act 1 — Make the messenger.** The one genuinely fiddly step is creating a Telegram bot, so the page holds the founder's hand in three plain lines with a screenshot-free promise of two minutes:

1. *"In Telegram, message **@BotFather** and send `/newbot`. Give it any name."*
2. *"BotFather replies with a token — a long code. Paste it here."* → one field.
3. On paste, Quire verifies the token live and echoes the bot back by name: *"Found your messenger: **QuireOrgBot**."*

**Act 2 — Introduce yourself.** No chat-id hunting. The page says: *"Now open a chat with QuireOrgBot and send it any message — 'hello' will do. We're listening."* The system polls the bot's updates and, the moment the founder's message arrives, replies on-screen: *"Found you: **Gilad** (chat 7134…). Is this you?"* → **Yes, that's me.** (Group chats work the same way — add the bot to the group and say hello there.)

**Act 3 — Purposes and the test tap.** Purposes are worded as *promises about what will buzz you*, and every one carries a **verb** — nothing here is a "read". The old "Digest / morning lede" purpose is **cut** (founder rethink 2026-07-22: a newsletter pushed to your phone is the cheap posture we're avoiding). What's offered:

- ☑ **Alarms** — *"a promise breaks or recovers. Rare and loud, with the quote and the one fix — this channel stays silent when the work is healthy."* (on by default; this is the differentiated beat)
- ☐ **The daily "anything waiting?"** — *"once a day, and only if something needs your signature: a queue of decisions with a link to act, never a summary. Silent on an empty desk."* (off by default — see open question 3; this is the ONLY periodic beat, and it is a decision queue, not a read)

There is no purpose whose payload is something to passively consume. If it buzzes your phone, it is because something wants your judgment.

Then the confirmation act: **Send a test tap.** The founder's phone buzzes:

> **Quire, checking in.** This channel now carries your org's alarms. When a promise breaks, the quote arrives here — and the link drops you on the page. *(test message — nothing is wrong)*

The channel row flips to **verified**, showing: transport, the bot's name, who it reaches ("Gilad, direct chat"), purposes, and *"last delivery: the test tap, just now."* A **Tap again** action stays on the row forever — trust in the tap must be re-checkable the morning of the demo.

### States and errors

`draft` (token pasted, unverified) → `awaiting_hello` (listening for the founder's message) → `verified` (test tap delivered) → `failing` (a real delivery errored; the row says so in red with the error in plain words and a "tap again" to re-verify). Errors in words: *"Telegram rejected that token — check for a missing character"*; *"We listened for 2 minutes and heard nothing — make sure you messaged **QuireOrgBot**, not BotFather."*

### How Slack slots in later (same shape, by design)

The connect flow is transport-agnostic in structure: **credentials → identify the destination → purposes → test tap.** For Slack (O6): Act 1 pastes a bot token or webhook URL, Act 2 picks/confirms the channel (`#quire-alarms`), Act 3 is identical. The backend `Channel` protocol (Part IV) means alarms code never learns which transport it's speaking to — a new transport is a new class and a new Act-1 panel, nothing else.

---

## Part IV — How it's built *(the founder can skip this)*

Everything here composes with O0 as shipped; nothing replaces it.

### Surfaces & routes (extends the A-plan's IA — no new top-level sections)

| Route | Surface | States it renders |
|---|---|---|
| `/` | Front Page | **The Docket** (decisions awaiting signature) + resident columns incl. onboarding states; the door |
| `/features`, `/feature/<id>` | **The Feature Overview** (pull pole) | live feature state — promises grouped beneath, computed fate, alignment, sessions, all drillable to the quote. The always-there destination for *checking* rather than *acting*. Feature lens ships in the demo; perspective-pivot (spend/risk/people) is the vision horizon. |
| `/journal` | The journal (river + composed narrative) | the moved "morning lede"/trending — reading is a deliberate visit here, never the landing |
| `/add-repo` | Signing Desk | acts 1–4; resumable via repo state |
| `/repo/<ws>` | Repo desk | as A2 |
| `/repo/<ws>/review/<n>` | Review Manuscript | as A2/A3 (deep-link target for alarms) |
| `/sessions` | Upload desk + list | envelope, `as_intent` toggle (O3/O4) |
| `/inbox` | All approval acts | parked repo drafts, correlation proposals, intent cards |
| `/channels` | Channels | connect flow, rows, test tap |

### Data (extending what O0 shipped — additive columns, same single-writer `OrgStore`)

**`org_repos`** (exists) gains:
- `status` extends its enum: + `scanning | drafting | awaiting_signature | error` (existing `active | fixture | frozen` untouched).
- `onboard JSONB` — progress transcript for Act 2 (list of `{ts, line, figure}` entries), draft pointer, and `error` message; cleared on activation. Keeps the desk resumable without a new table.
- `added_at`, `last_synced_at` (timestamps).

**`org_channels`** (exists, modeled but unwired) gains:
- `display_name` (the bot's name / Slack channel name), `status` (`draft | awaiting_hello | verified | failing`), `verified_at`, `last_error TEXT`.
- `config` jsonb per transport: Telegram `{bot_token, chat_id, chat_label}`; Slack later `{webhook_url}` or `{bot_token, channel}`. Plaintext for the demo per the model's existing note; encrypted at rest in production.

**`org_deliveries`** (new, small): `id, channel_id → org_channels, dedup_key, kind ("alarm"|"test"|"docket"), rendered_text, link, status ("sent"|"failed"), error, sent_at`. Note the `kind` enum has **no "digest"** — the periodic beat is `"docket"` (a decision queue), never a newsletter. Two jobs: (1) the alarm `seen`-set persists across restarts — `alarms_for(seen=...)` is fed from here, so the same unresolved break never re-pages after a reboot; (2) the channel row's "last delivery" sentence. Single writer: the delivery worker via `OrgStore`.

**Coupling contract data** is O3's as planned (`session_uploads`, existing `session_checks`) — this design adds nothing to it; the surfaces read it.

### API (extends `org_router.py`'s card API)

```
POST   /api/org/repos                {url}                → 202 {repo_id}  (creates row status=scanning, kicks onboard job)
GET    /api/org/repos/{id}/onboard                        → {status, transcript[], sources[], draft_cards[]}   (poll or SSE)
POST   /api/org/repos/{id}/sources   {approved_paths[]}   → re-drafts against the confirmed sources
POST   /api/org/repos/{id}/sign      {obligations[]}      → writes workspace, status=active, triggers first-results replay
GET    /api/org/repos/{id}/first-results                  → replayed verdict sentences as they land

GET    /api/org/channels
POST   /api/org/channels             {transport, config}   → verifies credentials (Telegram getMe), status=awaiting_hello
POST   /api/org/channels/{id}/detect                       → polls getUpdates; returns {found, chat_id, chat_label}
POST   /api/org/channels/{id}/confirm {chat_id, purposes[]}
POST   /api/org/channels/{id}/test                         → sends the test tap; verified on success
DELETE /api/org/channels/{id}
```

`GET /api/org` (exists) starts including onboarding-state repos so the Front Page renders their columns.

### The delivery path

```python
class Channel(Protocol):                       # backend/quire/channels.py (O5)
    def send(self, text: str, receipts: list[Receipt], link: str | None) -> DeliveryResult: ...

class TelegramChannel: ...                     # httpx → Bot API sendMessage (MarkdownV2), first transport
```

Flow: the O2 sync/watch loop → `alarms_for(ws, seen=OrgStore.seen_dedup_keys())` → route: every alarm goes to each **verified** channel whose purposes include `"alarms"` (demo: audience roles collapse to the one founder chat — see open question 4) → message = the already-built `render_telegram(alarm)` + one deep link `/{repo}/review/{n}` → `channel.send(...)` → `org_deliveries` row (success or failure; failure flips the channel to `failing`, never crashes the loop). The existing `Notifier`/`ConsoleNotifier` shape in `alarms.py` is subsumed by `Channel`; alarm composition code is untouched — O5 stays delivery-only, per the plan.

### Composition with O0 (explicit)

- `OrgStore` stays the sole writer for all org tables; card composition stays Python-side, no cross-store SQL.
- The Signing Desk drives the **existing** wizard engine: `scan_intent_sources` (with per-repo skip overrides), `propose.py` mining, `write_workspace` — orchestrated by the new `org_onboard.py` (O1 as planned), surfaced through the API above instead of the server-rendered wizard HTML.
- The GitHub adapter gains only `list_prs` (planned, O1/O2); `publish_comment`'s marker-upsert is used as-is.
- Seeded residents remain seeded; `POST /api/org/repos` adds alongside them. Un-adding a resident is deliberately out of the demo cut (open question 5).
- **The Docket** is pure composition over existing evidence — no new store: open reviews awaiting signature (alignment store), parked repo drafts + `watched` repos + intent cards (`OrgStore`), ranked by the alarm policy's severity order (`alarms.py::_RANK`) so the Front Page, the daily "anything waiting?" tap, and the phone all agree on priority. A `GET /api/org/docket` endpoint serves it as sentences-with-links; empty is a first-class, quiet state.

---

## Part V — Slices: smallest founder-visible increments

The plan's demo cut (O0→O1→O2→O3→O4→O5, paired A0–A5) stands. This design sub-slices two of them for earlier visible progress and earlier de-risking of the finale — same scope, reordered visibility:

| # | Slice | The founder sees (the increment) |
|---|---|---|
| 1 | **A0** (shell + Front Page over O0) | Opens `/` — **the Docket** leads (decisions awaiting signature), six residents standing beneath. The composed narrative lives at `/journal`, a click away. *(in flight per the A-plan; the Docket is the rethink's addition)* |
| 2 | **O5a — channel registration + test tap** *(pulled forward; needs none of O1–O4)* | Connects Telegram in three acts; phone buzzes with the test tap. The demo's finale hardware is proven on day one, and every later slice can end with a real tap. |
| 3 | **O1 + A1 — the Signing Desk** | Pastes a URL, watches the narrated read, signs seven promises, sees first verdicts in the same sitting. |
| 4 | **O2 + A2 — reviews arrive on their own** | Opens a PR on the governed repo; the verdict lands on GitHub and the manuscript appears here, unprompted. |
| 5 | **O3 + A3 — the envelope + the margin** | Uploads the session behind a PR; the manuscript's margin gains *"Reasoned in session…"*; an unaddressed upload becomes an Inbox proposal. |
| 6 | **O4 + A4 — intent cards at the Inbox** | Uploads a product-direction session as intent, signs two cards, and the next review cites this morning's words. |
| 7 | **O5b + A5 — alarms reach the channel** | A promise-breaking PR taps the phone with the quote; the link lands on the exact annotated review. Because of slice 2, this final slice is wiring an already-verified channel — small and safe right before the demo. |

Each slice ends with the plan's gates ([PY][APP][DEMO]) and, from slice 2 onward, *can* end with a literal tap on the founder's phone — the cheapest possible "see and react" loop.

> The O5a/O5b split is a sequencing recommendation inside ruling A, not a scope change: registration + test tap have zero dependencies on the review pipeline, and proving the finale's transport early is worth more than saving it for last.

---

## Part VI — Open questions (only the founder can answer)

1. **A repo with no signable promises** — ✅ **RULED 2026-07-22: no dead-ends.** It enters as a *resident under watch* (PRs recorded on the desk, no verdicts until it has a contract, which can grow via session-as-intent). Baked into the `watched` state above.
2. **Public verdicts on public repos** — ✅ **RULED 2026-07-22: yes, post them.** Quire's PR comments are public on the public demo repos; that beat stays. Baked into Beat 3.
3. **The daily "anything waiting?" tap** — the newsletter/Digest is cut; the only periodic beat is a once-a-day *decision queue* that fires **only when the Docket is non-empty** and stays silent otherwise. Two sub-questions: (a) in the demo cut, or post-demo? (recommend post-demo — the alarm tap is the finale, and adding a second scheduled beat risks muddying "silent when healthy"); (b) should it exist *at all*, or is the real-time alarm the only thing that should ever buzz your phone? (recommend: build it, default it OFF, let it prove itself.)
4. **One chat for every alarm** — alarms carry audiences (exec / product / engineering), but the demo has one founder and one chat. Recommendation: everything routes to your chat and the message keeps its "to: exec, product" line so the future is visible. Role→channel routing becomes real at O6. Confirm?
5. **Retiring a resident** — removing a repo (and disconnecting a channel beyond DELETE) is out of the demo cut in this design. Confirm the deferral?

---

## Part VII — The next phase (pointer)

Everything above is the *buildable demo cut*. The founder also asked, separately, what Quire *becomes* one horizon further out — the org's **product-management layer**, thought against Jira, GitHub, and Obsidian. That vision is kept in its own doc so it never muddies the near-term build:

→ **`docs/design/2026-07-22-quire-pm-layer-vision.md`** — the roadmap as living promises, "status" the system computes from what the code did, standup replaced by the org telling you what drifted overnight with the quote. It is a credible extension of today's primitives (promises, the entity graph, sessions-as-reasoning, alarms, the coupling contract), not a rewrite.

---

*Uncommitted by intent — for the founder's review. Companion plans: `2026-07-22-org-platform.md` (backend slices), `2026-07-22-web-app-recreation.md` (the app's face). Next-phase vision: `2026-07-22-quire-pm-layer-vision.md`.*
