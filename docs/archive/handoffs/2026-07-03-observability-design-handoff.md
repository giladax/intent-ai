# Handoff — Design Brain Observability (timeline + analysis)

> You are designing, not building. Deliverable: a design doc. Read the sources; form your own concept — the sharpest thing you can do is reject an assumption below and say why.

## The ask

Gilad (solo dev today, org product tomorrow) wants to **delightfully see what happens** in Brain: a timeline + analysis experience where he opens a view and *knows* — what sessions ran, what agents did and consulted, what Brain noticed, what's pending his approval, what Brain learned, how the eval is going. Today that knowledge lives in Postgres rows, CLI output (`events`), and scattered dashboard panels. "Delightful" is in the brief on purpose: this should feel like a story being told, not a log being tailed.

## What exists (read in this order)

- `docs/prd.md` — Brain PRD v0.3, **updated 2026-07-03**: Feature is the node, observations are human-gated, measurement is the current focus, integrations table shows what signals arrive later (PRs, tickets, Slack, incidents — your design should have somewhere for these to land).
- `docs/superpowers/specs/2026-06-21-activity-event-backbone-design.md` — the substrate. `activity_events`: time-ordered, self-contained, freeform `category`/`tags`, denormalized session context. **This is your spine; everything observable is (or should become) an event.**
- `src/web/` — existing dashboard: three-panel layout, Features page, FeatureDetail, ReviewQueue (WS-B, commit `0b878ae`). Work with or against it — your call, but say which.
- Prior UX direction (from earlier iterations, not binding): breadcrumb navigation, narrative-as-chat, center-stage content model.

## Honest state — the dark lanes

The timeline's most interesting lanes are **not instrumented yet**:
- MCP calls emit no events (finding F6, `docs/specs/2026-07-03-brain-api-review.md`) — agents consulting Brain is invisible.
- Eval runs should emit `eval:run` events (`docs/specs/2026-07-03-measurement-v2-spec.md` §3.7) — not built.
- `brain_versions.commit_sha` is empty everywhere — no code-version anchor.
- Session digestion is batch/CLI; the daemon (`src/daemon/`) watches live but its output path is unsettled.

Part of your job is to **specify the instrumentation your design needs** (event categories, fields) so the build order falls out of the design — don't design only for the data that exists.

## Questions your design should answer (not prescriptions)

- What does Gilad see in the first 5 seconds that tells him "here's what happened since you last looked"?
- How do the different actors (him, coding agents, the pipeline, the observation layer, eval runs) read differently on one timeline without becoming lane soup?
- Where does *analysis* live vs. *chronology* — and what's the gesture that moves between them (a spike in observations → why?)?
- What's the pending-approval experience so the human gate feels like a joy, not a chore? (It's the loop's bottleneck; PRD Principle 5.)
- What scales from 1 dev to a team without redesign?

## Good result

A design doc in `docs/plans/` or `docs/specs/`: concept + information architecture, the timeline model (lanes/zoom/grouping — your invention), 2–3 key screens described or sketched (ASCII fine), the instrumentation contract it requires, and a phased build plan where phase 1 is demoable in days. Name your open questions and taste calls explicitly — a confident partial design beats a complete bland one. Constraints: shadcn/React stack already in `src/web/ui`; events remain freeform (no enums — CLAUDE.md anti-pattern); don't redesign the pipeline, only its visibility.
