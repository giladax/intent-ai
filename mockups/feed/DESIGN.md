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

## The editorial voice

The Brain writes the feed; these are its style rules, all demonstrated with real corpus
material (9 sessions, 484 events, 347 moments — the Jul 3–4 story: 191 + 109 = 300
events in 48 hours):

- **Written like it knows the reader.** Second person, specific: "At 1:14 a.m. *you*
  told the pipeline it wasn't good enough." Never "activity was detected."
- **Every claim walks back to a transcript line.** Quotes are verbatim from moments
  ("worse than noise — it's negative value"), timestamps are real (scheduler · fri
  22:26), and evidence chips under each unfold are the citations. The byline says so.
- **Headlines are verdicts, not labels.** "The reader learned to slow down," not
  "Digest Pipeline Update." A headline must survive being read aloud to a C-level and
  to the engineer who lived it.
- **Tension before resolution.** Lead with the challenge or the pivot; land on what
  held (tests passing, the scheduler firing unattended). Struggles stay visible — the
  401 key failure is a brief, not a secret.
- **Terse per the essence principle.** A trending dek is ≤3 sentences; an unfold is two
  paragraphs; the lede is one. The chat is where depth lives — the Brain offers it as a
  question, never dumps it.

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
| `03-feature-page.html` | Feature lens focused (rail fades around 01 FEATURE, real per-feature moment counts): the feature's top-level editorial page — story, state band, open question — then the seam, then the chat already begun below it. |

Rail additions over lens-chat: **00 ORG** (ink box — the feed is the org lens, "you are
here") and the ghost box is now **+ ROLE LENS** (`exec · product · eng — soon`) — lenses
by the reader's seat in the company are the contract for what grows next.

`shots.mjs` re-captures `shots/` (playwright-core + installed Chrome, 1440×900@2x; the
02 shot is taken *after* the press interaction fires). Palette and type unchanged from
lens-chat: paper `#EFE5CE`, ink `#1C1A15`, cobalt `#2B49D8`, vermilion `#D8492B`,
marigold `#ECA636`, moss `#2E6B58`, amber `#B4681E`.
