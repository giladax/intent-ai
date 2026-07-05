# Brain — Clean-Room Concept: "Quiet Intelligence"

## The concept

Brain is not a dashboard; it is a presence. The screen rests near-empty — warm bone paper,
a small breathing mark (the brain, alive), and one verdict sentence set in a serif that a
board deck would trust: *"Quiet, and on course."* Everything else exists only as latent
memory until intent summons it. The single ask-bar is the entire front door; the river of
events is a one-pixel seismograph at the bottom edge — present, never loud. Trust is a
texture, not a claim: prose lives in Fraunces, but every piece of evidence is set in mono
on ink — the raw transcript is visually *bedrock*, and every sentence the brain speaks can
be walked down to it in four hops along a drawn spine (claim → feature → moment →
transcript line). Three audiences share one brain through a lens pill, never through
three UIs: the exec gets the verdict, the engineer gets the walk, the product lead gets
the seal — and after the seal, the interface returns to quiet, because emptiness is the
reward.

## The motion language

Nothing *appears* — things **materialize**: `blur(10px) → 0` + a short rise + a breath of
scale, on one shared curve (`cubic-bezier(.22,1,.36,1)`), staggered ~80–130ms so the
interface assembles like a thought completing. Nothing *navigates* — things **morph**: the
ask-pill you type into sheds its chrome and its text re-sets as the serif heading of the
answer, in place; the approval card doesn't close, it is stamped (one spring curve, the
only bouncy easing in the system), recoils like ink on paper, then flies *into* the river,
which ripples once where it lands. Exits are dissolves (blur + fade), never cuts. Verdicts
arrive word-by-word; evidence spines draw themselves top-to-bottom. The only perpetual
motion is breathing — the brain's pulse, the amber tick of a thing that needs you — at
5.4s, calm, never spinning. `prefers-reduced-motion` collapses all choreography to
settled states.

## "Surface by intent," mechanically

Intent is a gradient, and the interface answers in proportion:

1. **Hover whispers** — dashed-underline phrases inside the verdict are *intent handles*;
   resting on "Three decisions" materializes a preview (the three, verified, timestamped)
   that dissolves when attention leaves. Same for river ticks. Nothing persists.
2. **Click speaks** — a citation chip summons the four-hop evidence walk *inline, under
   the sentence it supports*; clicking again dissolves it. The walk is never a page.
3. **Ask commands** — the ask-bar is the only permanent affordance. A question makes the
   interface rebuild around it: chrome dissolves, the question becomes the headline,
   evidence chips fly in *before* the answer (you watch the brain gather), then the
   verdict materializes and the rest shimmers until it's earned.
4. **Approval happens in the conversation** — the delta card is a turn in the dialogue,
   not a queue screen; sealing it increments understanding (v12 → v13), files it into the
   river, and returns you to emptiness: *"Nothing else needs you."*

The rule underneath all four: **the default state of every pixel is absent.** A thing may
occupy the screen only while it is the answer to a present intent — then it dissolves back
into the river.

## Files (a flow, not pages)

| File | Beat |
|---|---|
| `01-arrival-the-verdict.html` | Exec arrives: breathing mark, one verdict, ask-bar, 1px river. Hover-whispers on intent handles. |
| `02-ask-the-brain-materializes.html` | Engineer asks; the pill morphs into the headline; memory counters, evidence gathers, verdict forms word-by-word. |
| `03-answer-with-evidence-walk.html` | The settled answer; a citation chip opens the 4-hop spine down to mono-on-ink transcript bedrock. |
| `04-approval-sealed-into-memory.html` | Product lead seals an understanding delta (v12→v13): stamp, sparkle, card flies into the river, quiet returns. Append `?sealed=1` to watch it auto-seal. |

Type: **Fraunces** (verdicts/prose) · **Hanken Grotesk** (interface) · **Spline Sans Mono**
(evidence, line numbers, the river's labels). Palette: bone `#F5F1E8`, ink `#1C1A15`,
moss `#2E6B58` (the brain, verified, aligned), amber `#B4681E` (needs you, drift). Data
shapes mirror the real DB (moments with type/confidence/verification, feature
understanding versions, evidence quotes, activity-event river).
