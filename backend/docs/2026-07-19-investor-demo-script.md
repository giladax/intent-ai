# Quire — Investor Demo Runbook (v2: script + integrated manual)

Target: 9 minutes + 2 spare. Two workspaces, both real, both local — no
network dependency, zero LLM calls during the demo. The one live
mutation is the founder's own signature.

**The thesis sentence (memorize):** "AI writes most code now, so teams ship
faster than they understand. Quire reads what you promised to build,
watches every merge, and flags the moment the code breaks a promise —
with the exact file and line. Every AI coding tool makes this problem
worse. We're the check on all of them."

v2 note: the two rehearsal-round product minors are FIXED — pasted
trails now resolve ancestor names, and a crowded constellation shows
important thoughts only (and says so). The old "never paste deep links"
rule is retired; clicking remains the rehearsed path.

---

## Part 0 — Founder prep (do once, before the pitch day)

### 0.1 The counter-signature pass on telegram (~15 min)

Beat 2's line — "my assistant onboarded it, every decision attributed,
and I counter-signed" — must be TRUE. Decisions in the log are final
(that is the product), so you counter-sign by adding your OWN signed
acts on top:

1. `cd ~/dev/intent-ai/alignment && python3 -m quire.cli up telegram`
2. Walk each of the 7 records (rail → What we build). For each entity:
   - **If the name and grouping are right:** teach it one word of your
     own dialect — "+ teach it a word" on the record. One word, signed,
     instant. Your name enters the diff log.
   - **If anything is wrong:** correct it on the spot ("wrong name…" /
     detach via the record's correct verbs) → an open card appears →
     sign it in the inbox. Rejections teach; your reason is kept.
3. Skim the 11 promises under **What we promised** (spec door). If one
   reads wrong, edit `workspaces/telegram/obligations.yaml` directly —
   the contract is the human layer; note the revision.
4. Done when: `python3 -m quire.cli proposals telegram` shows
   nothing waiting, and the decided history shows YOUR name at least
   once per entity you touched.

### 0.2 State check for quire-brain (2 min — verify, do NOT change)

The script is rehearsed against this exact state:
- 5 proposals open (GD-6..GD-10). **Sign nothing before the demo.**
- GD-9 is YOUR live-signing beat. GD-8 must stay open forever-ish (it
  is beat 6's exhibit: the mind caught it contradicting a signed
  promise).
- Banner reads "2 promises broken · 1 partly kept · 5 questions wait."

### 0.3 The timed rehearsal (the CPO's second condition)

Run the flow below once, alone, timed, saying the lines out loud:
- Pass bar: under 11 minutes; zero dead clicks; beats 1, 3, and 7
  delivered without reading.
- Log every stumble in one line each; anything that stumbles twice,
  tell Claude — it becomes a fix, not a workaround.
- Record a full clean run as the fallback video.

---

## Part 1 — Pre-demo checklist (10 minutes before, every time)

```
lsof -ti tcp:8321 | xargs kill          # stale servers 404 new routes
cd ~/dev/intent-ai/alignment
python3 -m quire.cli up --no-open
```
1. Open two tabs and hit each once (warms story caches):
   `http://127.0.0.1:8321/app/telegram#/map` and
   `http://127.0.0.1:8321/app/quire-brain#/map`.
2. 20-second verify: telegram shows 7 entities + lede; quire-brain
   banner says 5 wait; inbox has GD-6..GD-10.
3. Reviewer name: if the browser has never signed here, the first Sign
   will prompt for a name — it should be YOURS. (Test on page load by
   clicking "+ teach it a word" and cancelling at the prompt.)
4. Wifi can die; everything is local. Have the fallback video on the
   desktop anyway.

---

## Part 2 — The flow (say-line · clicks · what lands · what it proves)

**Beat 1 — cold open on a repo they believe (60s).**
- *Clicks:* tab 1, already on `/app/telegram#/map`.
- *Say:* "This is a Telegram assistant my team built — seventeen
  commits, one design doc. Quire read it, and this is the map: what it
  IS, in its own words."
- *They see:* 7 parts of the product, named in its own vocabulary (Quiet by
  Default, CEO Alerts, Fact Merging), the lede story, the ring rail
  (What we build / What we promised / What's changing…).
- *Proves:* generality — a real external repo, onboarded in an
  afternoon.

**Beat 2 — the story, and the signature culture (45s).**
- *Clicks:* none — point at the lede.
- *Say:* "Every sentence here is machine-written and mechanically
  checked. And notice who signed: my assistant onboarded this, every
  decision attributed — and I counter-signed under my own name.
  Machines propose; humans sign."
- *Proves:* the trust model — attribution is a feature.

**Beat 3 — the recovery walk (90s). Hero moment #1.**
- *Clicks:* rail → What we build → **Fact Merging** → on its record,
  the Jaccard promise ("Facts must be deduplicated… Jaccard > 0.6",
  *kept · since check #4*) → click its ref → in the navigator: click
  **check #1** (partially satisfies · `mergeFacts.ts:1`) → back → click
  **check #4** (satisfies · `mergeFacts.ts:14`).
- *Say:* "The system watched this promise slip, and watched the team
  fix it — file and line, both times. Nothing here is a vibe: click
  anything and you land on evidence."
- *Proves:* the IP — cross-examinable understanding.

**Beat 4 — switch: the product on itself (30s).**
- *Clicks:* tab 2, `/app/quire-brain#/map`.
- *Say:* "Same product, pointed at its own repo — we drink our own
  champagne, and it has caught us twice."
- *They see:* the banner (2 broken · 5 wait), the lede narrating
  check #7.
- *Proves:* conviction + honesty.

**Beat 5 — the teaching arc (75s). Hero moment #2.**
- *Clicks:* rail foot → **navigator** → chip **GD-1** (or search
  `GD-1`).
- *Say:* "The machine proposed calling this grouping 'Brain'. I
  refused — wrong name — and the refusal TAUGHT it: the name died, the
  grouping stayed free, and the next day it came back as 'External
  System Boundaries' — still waiting for my sign-off. My call."
- *They see:* GD-1 struck (*declined by cpo · wrong name*), and the
  mind's own thought "GD-1 Rejection → GD-10 Reframe" narrating the
  arc on the same screen.
- *Proves:* the learning loop — rejection is training signal, with
  receipts.

**Beat 6 — the mind's catch (45s).**
- *Clicks:* rail → **What the mind wonders** → "Raw Session Archive vs
  No Source Artifact Storage."
- *Say:* "Its own unsigned thinking flagged that one of MY pending
  proposals contradicts a promise I already signed. It protects me
  from myself — before I sign."
- *Rule:* this is why GD-8 is never the live-sign beat.
- *Proves:* machine judgment bounded by evidence.

**Beat 7 — the founder signs, live (60s).**
- *Clicks:* banner → "Open the inbox →" → GD-9's collapsed row →
  expand.
- *Say:* read the plain-language summary aloud, then point at the
  button: "It tells me exactly how much my signature binds — one part
  of the product, three links into the code." Click **Sign**. The
  stamp lands.
- *Say:* "That's the only way this map ever changes — a named human, a
  scoped signature."
- *Proves:* one mutation path — auditable governance.

**Beat 8 — teach it your words (45s).**
- *Clicks:* tab 1 (telegram), ask box: type `who pings the ceo` ⏎.
- *They see:* an honest refusal — "won't guess" — naming CEO Alerts
  nearest by meaning. Click the teach chip; signed; ask again: instant.
- *Say:* "It never guesses, and it learns your organization's dialect
  permanently — from you, not from scraping."
- *Proves:* honest AI + compounding org-specific moat.

**Beat 9 — the constellation + the economics close (60s).**
- *Clicks:* `/app/telegram#/constellation`.
- *Say:* "Signed knowledge and unsigned thinking — one sky." Then the
  close: "And the unit economics: every screen you saw costs zero
  model calls. Understanding is computed when the org changes — a
  handful of calls a day, cached until the world moves. Tokens are
  COGS we control."
- *Proves:* economics.

---

## Part 3 — Recovery moves (when something goes sideways)

| Symptom | Move |
|---|---|
| Page blank / 404 on a route | Stale server. `lsof -ti tcp:8321 \| xargs kill` then `up --no-open`; re-warm both tabs (60s, narrate the thesis meanwhile). |
| Clicked into the wrong page | Breadcrumb "the map" (top-left) always goes home; the rail is always present. |
| Ask misroutes on a novel query | Only rehearsed queries live (`alerts`, `who pings the ceo`). If it happens: "it refused rather than guessed — that's the design," move on. |
| Name prompt appears at Sign | Type your name; it's the signature. Never cancel mid-beat — cancel = nothing signed. |
| Accidentally opened GD-8's card | Do not touch the buttons; collapse and open GD-9. Nothing signs without the Sign click. |
| A story shows "N sentences withheld" | Feature, not bug: "the machine wrote a sentence its own validator couldn't prove — so it withheld it." Best ad-lib in the deck. |

## Part 4 — The three hardest questions, answered by the demo

- **"What stops GPT-next from doing this?"** → The moat isn't the
  model — it's the trust machinery (beats 3/5/7): validated citations,
  signed mutations, taught vocabulary accumulating per-org. Swap the
  model tomorrow; the discipline and the signed map remain ours.
- **"Isn't this just another dashboard/wiki?"** → Beat 3: click any
  claim to the exact line. Wikis assert; Quire proves. Obsidian has
  graphs; nobody has cross-examination.
- **"What does it cost to run?"** → Beat 9, plus one number ready:
  onboarding telegram cost ~12 model calls end-to-end; steady state is
  ~1 call per PR plus retells on change. The $/org/month envelope goes
  on a slide, not in the demo.

## Part 5 — Do NOT show / do not linger

- Telegram check #2's NO-PRODUCT-IMPACT verdict (plausible miss on a
  fix commit — under review; don't open check #2).
- Unexercised promises are honest — fine on screen, don't dwell.
- The onboarding wizard (works, but multi-minute and LLM-live — say
  "an afternoon, assisted" and move on).
- Never sign GD-8 (beat 6's exhibit).
- Free-typing novel ask queries — rehearsed ones only.

## Rehearsal log + verdicts (round 1, CPO+CTO)

CTO walked every beat with screenshots (demo-*.png): all land; beat 5
lands better than scripted (the mind narrates the arc on-screen); beat
6's prop location was fixed in-round (shelf, not record). Lingo check:
no "clerk"; ids only as footnotes; "in quires" always glossed. Verdicts:
**CPO — YES, conditional on the counter-signature pass (Part 0.1) and
one timed founder rehearsal (Part 0.3). CTO — YES** — zero LLM calls,
one mutation (the founder's), stale-server is the only rehearsal-killer
and the checklist leads with it. Both round-1 product minors fixed in
v2 (ancestor trail chips resolve names; constellation density control).
