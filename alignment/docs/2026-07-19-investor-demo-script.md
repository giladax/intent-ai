# Investor demo script — Quire (v1, CPO+CTO rehearsed)

Target: 9 minutes + 2 spare. Two workspaces, both real, both local — no
network dependency, zero LLM calls during the demo (every surface is
read-composed; the one live mutation is the founder's own signature).

**The thesis sentence (memorize):** "AI writes your code faster than
your organization can understand itself. Quire is the understanding
layer: it reads what you promised, watches what you built, and keeps a
map humans sign — so every claim on screen can be cross-examined down
to the exact line of code."

---

## Pre-demo checklist (10 minutes before)

1. **Fresh server, always**: `lsof -ti tcp:8321 | xargs kill;
   cd ~/dev/intent-ai/alignment && python3 -m quire_align.cli up --no-open`
   — a stale server 404s new routes and blanks pages (we hit this in
   rehearsal twice).
2. Open two tabs, pre-warmed: `/app/telegram#/map` and
   `/app/quire-brain#/map`. Hit each once so story caches serve warm.
3. Verify in 20 seconds: telegram map shows 7 entities + lede;
   quire-brain banner says "5 questions wait"; inbox has GD-6..GD-10
   open (the founder signs ONE live — decide which beforehand: GD-9 is
   smallest and safe; do NOT sign GD-8 — see beat 6).
4. Backup: everything is local (wifi can die); also record a full
   run-through as a fallback video the night before.
5. Reviewer name in localStorage is the founder's (sign a throwaway on
   a COPY beforehand if unsure, never the demo workspace).

## The flow

**Beat 1 — cold open on a repo they believe (60s).**
`/app/telegram#/map`. Say: "This is a Telegram assistant my team built
— seventeen commits, one design doc. Quire read it and this is the
map: what it IS, in its own words." Investor sees: 7 entities named in
the product's own vocabulary (Quiet by Default, CEO Alerts, Fact
Merging), the lede story, the ring rail (What we build / What we
promised / What's changing…). Proves: **generality** — not a demo rig,
a real external repo, onboarded in an afternoon.

**Beat 2 — the story, and the signature culture (45s).**
Point at the lede. Say: "Every sentence is written by the machine and
mechanically checked — and notice WHO signed: my assistant onboarded
this, every decision attributed, waiting for my counter-signature.
Machines propose; humans sign." Proves: **the trust model** in one
glance — attribution is a feature, not a smell.

**Beat 3 — the recovery walk (90s). The hero moment #1.**
Click Fact Merging → the promise "Facts must be deduplicated…
(Jaccard > 0.6)" → its record shows *kept · since check #4*. Walk it:
check #1 — *partially satisfies* — `src/digestion/mergeFacts.ts:1`;
check #4 — *satisfies* — `mergeFacts.ts:14`. Say: "The system watched
this promise slip, and watched the team fix it — file and line, both
times. Nothing here is a vibe; click anything and you land on
evidence." Proves: **the IP** — cross-examinable understanding.

**Beat 4 — switch: the product on itself (30s).**
`/app/quire-brain#/map`. Say: "Same product, pointed at its own repo —
we drink our own champagne, and it has caught us twice." Investor
sees: the banner (2 broken · 5 wait), the lede narrating check #7.
Proves: **conviction + honesty** — we show our own broken promises.

**Beat 5 — the teaching arc (75s). The hero moment #2.**
Navigator: `#/explore/GD-1`. Say: "The machine proposed calling this
grouping 'Brain'. I refused — wrong name — and the refusal TAUGHT it:
the name died, the grouping stayed free, and the next day it came back
as 'External System Boundaries' — in quires, still unsigned, my call."
Walk GD-1 (struck, *declined by cpo · wrong name*) → GD-10 (in
quires). Proves: **the learning loop** — rejection is training signal,
with receipts.

**Beat 6 — the mind's catch (45s).**
Still on quire-brain: rail shelf **What the mind wonders** → click
"Raw Session Archive vs No Source Artifact Storage" (it is unanchored
— its promises are the homeless ones — so it lives on the shelf, not
on a record). The navigator opens it: gloss + three neighbors
(QUIREB-005, GD-8, QUIREB-012). Say: "Its own unsigned thinking
flagged that one of MY pending proposals contradicts a promise I
already signed — it protects me from myself, before I sign." (This is
why GD-8 is never the live-sign beat.) Proves: **machine judgment
bounded by evidence** — the mind thinks freely but cannot lie.

**Beat 7 — the founder signs, live (60s).**
Inbox → GD-9's card. Read the plain-language summary aloud, point at
the button: "Sign — 1 entity, 3 bindings. It tells me exactly how much
my signature binds." Sign it. The stamp lands. Say: "That's the only
way this map ever changes — a named human, a scoped signature."
Proves: **one mutation path** — governance investors can audit.

**Beat 8 — teach it your words (45s).**
Back on telegram, ask box: type `who pings the ceo`. It refuses —
"won't guess" — but names CEO Alerts as nearest by meaning. Teach it
(one click, signed). Ask again: instant. Say: "It never guesses, and
it learns your organization's dialect permanently — from you, not from
scraping." Proves: **honest AI + compounding org-specific moat**.

**Beat 9 — the constellation + the economics close (60s).**
`/app/telegram#/constellation`. Say: "Signed knowledge and unsigned
thinking, one sky." Then the close: "And the unit economics: every
screen you saw costs zero model calls — understanding is computed when
the org changes, a handful of calls a day, cached until the world
moves. Tokens are COGS we control." Proves: **economics**.

## The three hardest questions, answered by the demo

- **"What stops GPT-next from doing this?"** → The moat isn't the
  model — it's the trust machinery (beats 3/5/7): validated citations,
  signed mutations, taught vocabulary accumulating per-org. Swap the
  model tomorrow; the discipline and the signed map remain ours.
- **"Isn't this just another dashboard/wiki?"** → Beat 3: click any
  claim to the exact line. Wikis assert; Quire proves. Obsidian has
  graphs; nobody has cross-examination.
- **"What does it cost to run?"** → Beat 9 + one number ready:
  onboarding telegram cost ~12 model calls end-to-end; steady state is
  ~1 call per PR + retells on change. Put a $/org/month envelope on a
  slide, not in the demo.

## Do NOT show / do not linger

- Telegram check #2's NO-PRODUCT-IMPACT verdict (plausible miss on a
  fix commit — under review; don't open check #2).
- Unexercised promises are honest — fine on screen, don't dwell.
- The onboarding wizard (works, but multi-minute and LLM-live — say
  "an afternoon, assisted" and move on).
- Do not free-type novel ask queries — use the rehearsed ones
  (`alerts`, `who pings the ceo`); an unrehearsed refusal is fine, an
  unrehearsed misroute is not.
- Never sign GD-8 (the mind's contradiction catch is beat 6's prop).
- **Walk clicks, never paste deep links live**: trail chips learn
  names as you walk; a pasted URL shows raw ids for unvisited
  ancestors (known residual). Every beat above is reachable by click.

## Rehearsal log + verdicts (round 1)

**CTO walk-through, every beat, screenshots demo-*.png (read, not
assumed):** Beat 1 telegram map — 7 entities, ring rail with counts,
lede narrating the recovery arc and the Group-Chat-Handler refusal:
lands. Beat 3 recovery walk — promise focus "kept · since check #4",
check #1 partially-satisfies mergeFacts.ts:1 → check #4 satisfies
mergeFacts.ts:14, whys folded: lands (via clicks; pasted-URL id-chip
residual noted above). Beat 4 quire-brain map — banner "2 broken · 1
partly kept · 5 wait": lands. Beat 5 GD-1 — declined badge, struck,
"declined by cpo · wrong name", and the mind's own "GD-1 Rejection →
GD-10 Reframe" thought renders on the same screen narrating the arc:
lands better than scripted. Beat 6 — FIXED this round: the thought
lives on the What-the-mind-wonders shelf (unanchored), not Feature's
record; script corrected, focus verified (gloss + 3 neighbors). Beat 7
inbox — GD-6 expands first with "Sign — 1 entity, 3 promises, 4
bindings, 3 words"; GD-9's collapsed row present; Sign flow verified
to the button, not clicked. Beat 8 ask — "alerts" resolves semantic →
CEO Alerts deterministically offline; "who pings the ceo" refuses and
names CEO Alerts nearest-by-meaning: both rehearsed. Beat 9 telegram
constellation — 7 signed + 13 thoughts: lands; minor label collisions
at this density (Fact Merging/CEO Alerts run together) — acceptable in
the wide shot, logged as product-minor.

**Lingo check on rendered output:** no "clerk" anywhere; ids appear
only as footnotes/refs, never headline text; "in quires" always beside
"proposed/unsigned" gloss. One flag: the telegram lede says "claude
(assisted onboarding)" three times — beat 2 turns this into the
attribution feature ON PURPOSE; founder must deliver that line, or the
lede reads oddly.

**Verdicts:**
- **CPO — WOULD-THIS-CLOSE: YES, conditional on two things** — (1) the
  founder re-signs the telegram map before the real pitch (beat 2's
  line works once; a room that probes "so the AI graded itself?" needs
  the counter-signature story to be TRUE by then), and (2) one full
  live rehearsal by the founder himself, timed.
- **CTO — WOULD-THIS-CLOSE: YES** — every beat renders from local
  state with zero LLM calls; the one mutation is the founder's
  signature; stale-server is the only failure mode that killed a
  rehearsal and the checklist now leads with it. Product-minors logged
  (constellation label collisions; pasted-URL id chips) — neither
  reachable by the scripted path.

**Script defects fixed in-round:** beat 6 prop location (was Feature's
record; the thought is shelf-anchored). **Product defects (minor, not
demo-blocking):** constellation label overlap at 20 nodes; trail
chips show ids on unvisited ancestors.
