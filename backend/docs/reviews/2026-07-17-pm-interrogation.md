# PM interrogation of the live system (quire-brain workspace)

Untrained PM-persona agent, live API/CLI. Full transcript summary:
verdict "maybe → yes-with-fixes". Strongest: per-PR reports ("the standout
answer": promise table, file:line evidence, explicit next action) and
honest refusals ("billing" → 0.0 unresolved earned more trust than any
correct answer). Q2 "where are we on serving context to agents?" →
precisely right area, real contradicted promise with provenance.

Failures (all routing, not data): (1) no overview answer — "what are the
areas?" / "is anything red?" get force-resolved into ONE area card; Q3
confidently implied all-quiet while a contradiction existed one area over
= the biggest trust hazard. (2) Verdict vocabulary differs across CLI /
timeline JSON / cards (NOT COVERED vs UNGOVERNED vs OFF_INTENT). (3)
Status-shaped questions ("what's uncovered lately?") should route to the
timeline, not term-matching; unresolved should suggest nearest areas.
Also: `since: 7` unexplained, reasoning truncated mid-sentence, `list`
interleaves workspaces with colliding PR numbers.

These map 1:1 onto the experience spec's "situation mirror" (overview +
health rollup + findings inbox) — independent validation of that spec's
priority order.
