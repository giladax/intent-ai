# Digestion Provenance Events + Session Zoom View — Design

**Date:** 2026-07-04 · **Status:** approved-direction (user: "I would like to zoom in to be able to grasp the digestion quality; it will help evals and agentic code sessions")
**Context:** Sittings, chunks, digest runs, and the digester's own reading are invisible in the journal — digestion quality is only inspectable via psql. This spec makes digestion structure journal-native and gives it a zoom UI. Depends on: understanding-stage rewrite (shipped), agents-core Task 5 agent-trace events (in flight).

## Part A — Digestion-provenance events (journal-native, no new subsystem)

Emitted by every digest run (both arms), through the existing `emitEvents` path, fail-safe:

| Event | category | occurred-time | metadata |
|---|---|---|---|
| Run summary | `digest:run` | session endedAt | arm (`pipeline` \| `agent`), sittingCount, chunkCount, momentCount, anchoredPct, verificationCounts, llmCalls/tokens where known, durationMs |
| Sitting boundary | `digest:sitting` | sitting startedAt | sittingIndex, eventRange, gap-from-previous ms |
| Chunk span | `digest:chunk` | chunk first event ts | chunkIndex, eventRange, topicHint, momentCount for this chunk |

Rules: `sourceType: "digest"`, `sourceId` = digest sessionId; occurred-time stamping (never digest-time); one emit batch with the existing moment/transition/outcome events so a failed store emits nothing (rides the Task-7 `stored` gate). The agent arm additionally emits its `agent-trace` events (Task 5) — same river, so pipeline and agent runs are comparable side by side with `events --category digest`.

Consumers: the zoom view (Part B); `search_events` (agents can query digestion-quality signals mid-session); the fidelity workflow (a run's anchoredPct visible without psql).

## Part B — Session zoom view (web)

One new session-detail mode in the existing dashboard (no new nav model): a horizontal **time axis** for the session.

- **Lanes** (top → bottom): sittings (bands, gaps rendered as visible breaks with duration labels) → chunk spans (thin segments, topicHint on hover) → moments (dots at occurred-time, colored by type, ringed by verification: supported/contradicted/unverified/none) → agent-trace (for agent-arm digests: tool-call ticks — what the digester read/checked, at wall-time).
- **Zoom interaction:** click a moment → side panel: statement, agency, confidence, evidence quotes each linking to its anchored event; "show transcript" expands the surrounding raw events (existing chunk-playback endpoint, now truthful). Click a chunk/sitting → its event range rendered (existing `getChunkEvents`).
- **Quality overlay toggle:** unanchored evidence highlighted; contradicted claims flagged; per-chunk moment density — the visual form of the fidelity eval's provenance checks.
- Data: everything comes from existing tables + Part A events; one new API route (`GET /api/sessions/:id/zoom`) assembling the timeline JSON server-side.

Non-goals: no graph-viz, no editing from the zoom view (comments-as-events is a separate journal feature), no cross-session timeline (that's the river itself).

## Why this feeds evals and agents

Inspection breeds criteria: a miss spotted in the zoom view becomes a new `fidelity-criteria` entry (the audit catalogs did exactly this by hand). Agents get the same signals programmatically via `search_events` on `digest:*` categories — e.g. a coding agent can check "was this session's digest well-anchored?" before trusting served context.

## Sequencing

1. Part A lands right after agents-core Task 5 (same files — orchestrator/emit — avoid collision).
2. Part B after E0 (so agent traces exist to display); implemented as its own small plan.
