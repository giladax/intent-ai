# Brain — The Feed: "The Editor of the Company"

Evolves the approved lens-chat foundation (`mockups/lens-chat/`) — warm cream paper,
Hanken Grotesk + Spline Sans Mono, the numbered flat-color lens rail, the pure main area,
the ask-bar — from **stats to editorial, from static to breathing**. The content model is
the change: the Brain is an editor, and the main page is the feed of the company.

## The hook: infinite chat

One continuous scrolling stream where **content and conversation are the same medium**.
Pressing anything — a trending story, a handle in the lede — does not navigate. It:

1. **Commits the press.** The card settles (`.pressed`): ink border, a flat colored
   shadow in its accent, the footer flips from `PRESS TO UNFOLD ↓` to `UNFOLDED ● BELOW`.
2. **Extends the stream.** A colored stem draws downward, the story's deeper cut clones
   out of a `<template>` into `#flow` at the stream's end, and its parts materialize in
   reading order (speaker → headline → paragraphs → evidence chips → the ask) on a
   staggered blur-rise (`.u1….u7`).
3. **Scrolls to meet it.** `scrollIntoView` (smooth, or instant under
   `prefers-reduced-motion`) carries the reader down — every press extends the story
   downward, never sideways.
4. **Ends with the Brain asking — then waiting.** Each unfold closes with a question
   turn (`.ask-turn`: bold question, three breathing wait-dots, suggestion chips) and the
   ask-bar takes the scope: a colored scope tag rides the pill, the placeholder re-aims
   ("Ask about the digestion rewrite…"), × returns to the whole feed. Multiple presses
   stack — the stream is infinite by construction.

## Voice rules (binding on all user-facing copy)

Internal development metaphors — river, sittings, ink, correspondence, editions — are
vocabulary for building this product, not for talking to users. User-facing copy follows
these rules:

- **State the value plainly.** Say what happened and why it matters. Never be clever
  about the product itself. The test: would a straight-talking founder say this out loud
  to a colleague? If not, rewrite it.
- **Tell the story, then leave a door open.** Lead with the real event or finding; close
  with a concrete question or unresolved thread that makes the reader want more. Not
  "the conversation never ends" — that's posturing. A real question ("Want to see what
  the audit caught?") works.
- **Every claim traces to evidence.** Quotes are verbatim from session moments; timestamps
  are real; evidence chips are the citations. Keep all data points — they are the
  credibility. Never invent or round.
- **Headlines carry the actual news.** "Digest quality was unverified for weeks — yesterday
  we audited it and rewrote the pipeline" beats "The reader learned to slow down." A
  headline must survive being read aloud to a founder and to the engineer who did the work.
- **Second person, specific.** "At 1:14 a.m. you told the pipeline it wasn't good enough."
  Never "activity was detected."
- **Terse.** A story card dek is ≤3 sentences; an expanded section is two paragraphs;
  the lead is one. The chat is where depth lives — the Brain offers it as a question,
  never as a dump.
- **Micro-labels: plain verbs win.** "Approve" / "Dismiss" over "Seal" / "Pull". "Expand"
  over "Unfold". If the label makes sense without knowing the metaphor, it's right.

## The trending heat model

Heat = **activity density × recency** per feature/subject over the event river
(`activity_events`): events + moments in the window, decayed by age. In the mockups the
numbers are the real river (daily: 44 · 17 · 25 · 37 · 19 · 42 · **191** · **109**).

Heat is *visible but never a chart*:

- **Ember dot** — the TRENDING rule carries one breathing vermilion dot.
- **Heat ticks** — seven 3px bars per story, phase-shifted `tickwave` breathing; cooled
  subjects (`.heat.cool`) freeze grey. Ambient life, not data-viz.
- **Heat words** — mono captions grade it: `still warm` / `hot` / `cooling`, with the
  real count ("191 events fri · 109 sat").
- **The rail river** — the 1px sparkline in the rail foot is the same daily heat, last
  two days in moss.

## Breathing (earned motion)

- **The now edge**: a 2px shimmer line at the stream's top (and at the feature page's
  page-to-chat seam) — a slow 7s gradient sweep marking where the river last moved.
- **Entrances**: headlines materialize word-by-word; everything else blur-rises once,
  in reading order. Nothing loops except life signs: the moss pulse, the ember, the
  heat ticks, the wait-dots.
- **`prefers-reduced-motion`** collapses all of it to settled states and instant scroll.

## The pages

| File | Beat |
|---|---|
| `01-the-feed.html` | Arrival: org-lens editorial overview (edition no. 9), trending stories with heat, briefs, ask-bar. Presses work here too. |
| `02-press-and-unfold.html` | The hook mid-flight: the hottest story auto-presses (`?pressed=1` jumps straight there) — stream scrolls, overview materializes, the Brain asks and waits, ask-bar scoped. |
| `03-feature-page.html` | Feature lens focused (rail fades around 01 FEATURE, real per-feature moment counts): the feature's top-level editorial page — story, state band, open question — then the seam, then the chat already begun below it. The Brain's seeded opening turn carries three things: top-level understanding (the editorial page above), recent insights, and the feature's pending approvals as inline actionable cards — stamp/discard without leaving the stream. |

Rail additions over lens-chat: **00 ORG** (ink box — the feed is the org lens, "you are
here") and the ghost box is now **+ ROLE LENS** (`exec · product · eng — soon`) — lenses
by the reader's seat in the company are the contract for what grows next.

`shots.mjs` re-captures `shots/` (playwright-core + installed Chrome, 1440×900@2x; the
02 shot is taken *after* the press interaction fires). Palette and type unchanged from
lens-chat: paper `#EFE5CE`, ink `#1C1A15`, cobalt `#2B49D8`, vermilion `#D8492B`,
marigold `#ECA636`, moss `#2E6B58`, amber `#B4681E`.
