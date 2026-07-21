# Plan — Slack + Telegram as events on a shared attention timeline

Founder directive (2026-07-20): integrate messages from Telegram and
Slack; "shout" an event timeline; "attention from Slack collides with
dev and the other way around." This is a demo killer and the
source-agnosticism proof.

This is not a new idea bolted on — it's the **journal-as-product**
vision (river primary, Features are lenses, comments-as-events are the
edge) realized with real comms sources, built on the exact pattern
session ingestion just proved (observed evidence → related to entities
→ propagates to reasoning/story/search).

---

## 1. The thesis (why comms belong on the map)

Today Quire sees: **intent (docs) → session (reasoning) → merge → drift.**
Comms add the two things that layer misses:

- **Where intent is actually DECIDED.** A PRD is the record; the *Slack
  thread* is where "high-risk refunds always need approval" was argued
  and agreed. That decision is a first-class source — often the *only*
  place a promise was ever stated.
- **Where ATTENTION flows.** Code shows what was built; comms show what
  the org was *looking at*. The gap between the two is the signal:
  talked-about-but-not-built, or built-in-silence.

One sentence for the room: *"Slack is where your org decides what it
wants; your code is what it did; we put them on one timeline and show
you where they disagree."*

## 2. The collision — the killer insight, defined

"Attention collides with dev" = correlate, per entity, per time window:
- **attention(E, w)** = density of comms events touching entity E,
- **dev(E, w)** = density of commits/checks/sessions touching E.

Four quadrants, each a signal the mind can raise (observed, cited):

| attention | dev | meaning | signal |
|---|---|---|---|
| high | high | focused push | aligned — the org is building what it's discussing |
| high | low | all talk | **a gap**: much discussed, little shipped (a promise at risk of never landing) |
| low | high | silent build | **a risk**: shipped with no discussion — was intent confirmed? |
| — | — | drift-in-context | a Slack thread *arguing for* X, next to a check catching code that broke X |

The demo beat: a real thread about the refund-approval promise, on the
timeline beside the merge that bypassed it and the check that caught it
— "the org SAID this, in writing, three weeks before the code broke it."

## 3. The event model — unify everything as ActivityEvents

We already have three event-shaped things (checks, sessions, signings)
plus atoms. Generalize to ONE time-ordered stream. An **ActivityEvent**:

```
{ id, source: slack|telegram|git|quire, kind, ts, actor,
  text (verbatim, quotable), touched: {entities[], promises[], paths[]},
  relates: [{ref, why}], decision?: {choice, why, rejected} }
```

- Dev events (already exist): commit/check (analyses), session
  (sessions.yaml), signing (diff log). Wrap these behind one reader.
- Comms events (new): message, thread (a correlated message cluster),
  decision (a thread where something was agreed), alert.
- **Facts are immutable; interpretation appends** — re-reading a thread
  makes a new event, never rewrites (our standing invariant).

This is the activity-event backbone made real. The timeline is the fold
over all sources, time on the axis, entities as the lens.

## 4. Ingestion (same discipline as sessions — observed, quote-or-drop)

**Telegram** — trivial first, we own it: the Bot API gives JSON; and the
telegram *workspace* already exists (Scout). A chat export is
line-delimited like a transcript — reuse the session reader's shape.

**Slack** — the real target. Two paths: a workspace export (JSON per
channel, zero-integration, demo-safe) for v1; the Events API + a bot
token for live later. Per message → an event; a thread → a cluster; if
a decision was reached, one cheap LLM call distills it (the digest
pattern, over words already written — token story holds).

**Relation to entities — three rungs, all quote-backed:**
1. **Channel → area**, human-taught: `#payments-eng → Payments` is an
   alias, signed once, forever (the teaching loop we built).
2. **Semantic**, by content: a message resolves to an entity through the
   relevance vectors (the org's dialect, already learned).
3. **People → entities**: an author who signs Payments decisions;
   deferred, but the slot exists.
A message that can't quote what tied it to an entity **does not relate**
(no-quote-no-render, applied to comms — this is the noise filter).

**Trust:** comms are OBSERVED and NOISY. They never sign. A decision in
a thread may *propose* (an attributed open card — "this Slack thread
agreed X; make it a promise?") but a human signs. PII: transcripts and
messages can carry it; ingestion redacts/consents before store (a
production gate, flagged now).

## 5. The surface — "What's happening" (the timeline)

A new door: the event river. Time down the page, newest first. Each row
is an event with its source glyph (slack/telegram/git/quire), its actor,
its quotable text, and its entity chips. Lenses (not modes): filter by
entity ("show me everything that touched Payments — the Slack argument,
the PR, the check, the session"), by source, by the collision quadrants.

The three moods still partition: signed (decisions), observed (messages,
checks, sessions), proposed (threads awaiting a human). Cross-examinable
as ever — click any event → its source (the actual message, the receipt,
the reasoning).

This is the ring's **"What's changing"** shelf, promoted to a
first-class timeline once comms make it dense enough to be the front
door the journal-as-product vision always wanted.

## 6. Build order (each slice lands alone, demo-first)

1. **Unify the reader** — one `events_for(workspace)` folding checks +
   sessions + signings into ActivityEvents. Pure refactor, no new
   source; the timeline view renders it. (Ships the river with what we
   already have.)
2. **Telegram ingest** — a chat export → message/decision events →
   related to entities by channel-alias + semantic. Reuses the session
   reader + digest.
3. **The collision** — attention/dev density per entity per window →
   the four-quadrant signal, surfaced as mind thoughts (cited) and on
   the timeline.
4. **Slack export ingest** — the real proof; same pipeline.
5. **Live Slack** (Events API + bot) — post-raise; needs OAuth,
   webhooks, rate limits, the PII gate.

MVP demo slice = 1 + 2 + 3 on one workspace: a real chat thread and a
real check on one timeline, the collision named. Offline/Fake path for
demo safety, like sessions.

## 7. What this proves for the pitch

- **Source-agnosticism** (the moat's breadth): intent, code, sessions,
  AND comms — all evidence through one trust machinery. "Add a source,
  it's one more edge type; the discipline doesn't change" (the
  extension guide, made real a second time).
- **The attention story** is unique — nobody correlates comms-attention
  with dev-activity per promise. AI code review lives at the PR; we live
  across the whole org's attention.
- **Economics unchanged**: events are cheap (mechanical); one LLM call
  only when a thread actually decided something.

## 8. Risks / open calls (for the CTO+CPO before build)

- Comms are 100× noisier than commits — the quote-or-drop relation rung
  is the whole ballgame; if it over-relates, the timeline is spam. The
  blind reviewer's take on our relevance thresholds matters here.
- The collision window (a day? a week?) and density normalization need
  calibration on real data — an eval case, not a guess.
- Slack ToS / data residency / PII — a real gate before any live tenant.
- Do NOT let a channel-alias become a back door to intent: a thread
  proposes, a human signs. One mutation path holds or the trust story
  dies.
