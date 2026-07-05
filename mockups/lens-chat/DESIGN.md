# Brain — Lens-Rail Concept: "One Conversation, Many Lenses"

## The concept

Brain is one conversation that can be *focused*. The left rail is a measured column of
numbered, flat-color boxes — 01 FEATURE (cobalt), 02 TIMELINE (vermilion), 03 TEAM
(marigold, soon), and a dashed `+ LENS` ghost for whatever the org grows next (Sprint,
Service, Customer). Each box is a lens, not a page: selecting one doesn't navigate, it
focuses. The rail fades around the choice, the chosen box opens to reveal its contents
(the six features, live from the DB), and the chat — the main event, always — re-scopes
itself to that slice of the brain. Everything else stays pure: warm cream paper, one
verdict sentence set in the same confident bold grotesk as the box labels (one type
language for the whole surface — the bar's language won), an ask-bar as the only
permanent affordance. Evidence cards, mini-timelines, citation chips, and approval stamps are not
side panels; they materialize *inside the conversation*, as turns in the dialogue, and
every one of them walks back to a raw transcript line in four hops (mono-on-ink is
bedrock). The Units borrow is only the discipline: numbered flat boxes, tiny labels,
arrow marks, huge confident type — none of the playfulness at the cost of B2B trust.

## How the lens rail works

- **Boxes are state, not links.** Each lens box carries a number, an arrow mark
  (↗ = available, rotated ↓ = open), a bold label, and one mono sub-line of live data
  ("6 under watch", "jun 21 — today"). An amber pulse dot on a box means something
  inside needs you — visible before you ever click.
- **Focus is a fade, not a swap.** Clicking 01 FEATURE: the other boxes drop to 26%
  opacity and desaturate, the chosen box grows (`min-height` transition) and its
  feature list staggers in (six rows, moment counts, selected row marked ●). The ghost
  `+ LENS` box fades furthest — future capacity, politely waiting.
- **Dynamic by design.** The rail is data: lenses can appear, reorder, and carry live
  counts. TEAM ships "soon" as a real box so the org sees where it's going; the ghost
  box is the contract that the menu grows.

## How chat-focus works

- **The scope rides the ask-bar.** Focusing a lens injects a colored scope tag into the
  pill ("◉ MCP SERVER ×") and recolors the pill's border — you always know what slice
  you're talking to, and × returns you to the whole brain.
- **The conversation re-anchors.** The unscoped verdict dissolves (blur + fade); a
  scoped turn materializes: a feature card (understanding version, moments, sessions,
  pending delta), a scoped verdict, and whisper chips. The speaker line names the scope:
  `BRAIN · LENS: FEATURE / MCP SERVER`.
- **Elements integrate inline.** Answers carry citation chips; a chip opens the 4-hop
  evidence walk (claim → feature → moment → transcript line) as a mono-on-ink card under
  the sentence it supports. "What changed this week?" draws a mini-timeline in the flow —
  axis draws itself, blips pop in type-colored, the pivot day gets a flag. Approvals are
  turns: the delta card (v7 → v8, +/− understanding lines, verified evidence chips) is
  sealed in place — spring-stamped, the card settles, the rail's amber dot dissolves and
  the Feature box ripples as v7 becomes v8 where you can see it.

## Files (a flow)

| File | Beat |
|---|---|
| `01-arrival.html` | Lens rail + pure chat. Verdict word-by-word, whisper chips, amber dot on FEATURE. |
| `02-lens-focus.html` | Click 01 FEATURE (auto-plays; `?focused=1` to jump): rail fades/opens, chat scopes, feature card materializes. |
| `03-conversation.html` | Scoped conversation: evidence walk on ink, citation chips, mini-timeline drawing itself inline. |
| `04-approval.html` | Delta awaits the stamp; Seal (or `?sealed=1`): spring stamp, rail ripple, v7→v8, "Nothing else needs you." |

`shots.mjs` re-captures `shots/` (playwright-core + installed Chrome). Type: Hanken
Grotesk (everything human — verdicts, labels, prose) / Spline Sans Mono (everything
machine — numbers, evidence, scope lines). Palette: paper `#EFE5CE`, ink `#1C1A15`, cobalt
`#2B49D8`, vermilion `#D8492B`, marigold `#ECA636`, moss `#2E6B58` (verified), amber
`#B4681E` (needs you). Data mirrors the live DB (9 sessions, 484 events, 347 moments,
6 features; real moment statements and evidence quotes). `prefers-reduced-motion`
collapses all choreography to settled states.
