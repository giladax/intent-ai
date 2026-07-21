# Table Census — journal Postgres (Slice 4, 2026-07-21)

Surveyed: `journal/src/storage/schema.ts` (32 tables; 22 LIVE + 10 DEAD), `journal/src/storage/queries.ts` (the query funnel), and all callers in `journal/src/`.

Verdict key: **LIVE** = has a production reader or writer; **DEAD** = defined in schema.ts but zero callers touching the DB table directly.

## Single-writer rule (Slice 4)

Five ingestion tables are now Python-owned. TS `storeSessionDigest` is demoted:
CLI `digest` command and `/api/brain/digest` endpoint print a deprecation notice
and exit without writing. TS code is preserved (vitest suites still test it);
only the production surface is demoted.

| Table | Readers | Writers | Verdict | Evidence (file:line) |
|-------|---------|---------|---------|----------------------|
| `activity_events` | `queryEvents`, `getFeatureObservations`, `getPendingObservations`, `loadFeatureContext` | `emitEvent`/`emitEvents`, `insertObservation`, `setObservationReviewStatus`, `updateObservationSummary`, `approveObservation`, `deleteSessionDigest` | **LIVE** | queries.ts:354-844; mcp/server.ts:489-576 |
| `attention_state` | `attention-store.ts` (SELECT) | `attention-store.ts` (INSERT/UPDATE), cli/infra.ts (CREATE IF NOT EXISTS) | **LIVE** | storage/attention-store.ts:26-38; cli/infra.ts:45-54 |
| `brain_cards` | none | none (0 rows in DB) | **DEAD** | schema.ts:374-390 only; 0 rows confirmed |
| `brain_versions` | none | none (0 rows in DB) | **DEAD** | schema.ts:364-370 only; 0 rows confirmed |
| `chunks` | `getChunkEvents` | **Python `quire/db/writer.py`** (as of Slice 4; TS `storeSessionDigest` demoted) | **LIVE** | writer.py:_write_all; queries.ts:103-109, 333-350 (demoted) |
| `feature_files` | `getFeatureFileRows`, `loadFeatureContext`, server.ts | `addFeatureFile`, seed-features.ts | **LIVE** | queries.ts:565-588; seed-features.ts:288 |
| `feature_sessions` | `getFeatureSessions`, feed-composer.ts | `storeSessionDigest` (via deleteSessionDigest), seed-features.ts | **LIVE** | queries.ts:590-606; seed-features.ts:292 |
| `features` | `listFeatures`, `getFeatureById`, `loadFeatureContext` | `approveObservation` (UPDATE), seed-features.ts | **LIVE** | queries.ts:550-562, 827-843 |
| `feed_cache` | `feed-composer.ts` (SELECT) | `feed-composer.ts` (INSERT ON CONFLICT) | **LIVE** | web/feed-composer.ts:495-525; 1 row in DB |
| `insight_evidence` | none | none | **DEAD** | schema.ts:329-335 only; topic-era |
| `insights` | none | none | **DEAD** | schema.ts:317-325 only; topic-era, 0 rows |
| `moment_evidence` | `getMomentEvidence`, `getSessionMoments`, `getFeatureMoments` | `storeSessionDigest` (LLM-stage only; Slice 5b/6) | **LIVE** | queries.ts:136-138, 224-253, 619-640, 687-701 |
| `moment_relations` | none (join only — no direct read helper; Python consumers must JOIN through it) | `storeSessionDigest` (LLM-stage only; Slice 5b/6) | **LIVE** | queries.ts:141-153 |
| `moments` | `getSessionMoments`, `getFeatureMoments`, `getMomentById` | `storeSessionDigest` (LLM-stage only; Slice 5b/6) | **LIVE** | queries.ts:113-138, 221-252, 611-640, 656-676 |
| `narrative_arcs` | none direct (joined via narratives) | `storeSessionDigest` (LLM-stage only; Slice 5b/6) | **LIVE** | queries.ts:193-197 |
| `narratives` | `getSessionNarrative`, `listSessions` | `storeSessionDigest` (LLM-stage only; Slice 5b/6) | **LIVE** | queries.ts:187-191, 204-219, 283-293 |
| `normalized_events` | `getChunkEvents`, server.ts raw_events join | **Python `quire/db/writer.py`** (as of Slice 4; TS `storeSessionDigest` demoted) | **LIVE** | writer.py:_write_all; queries.ts:83-93, 333-350 (demoted) |
| `outcome_files` | none direct | `storeSessionDigest` (LLM-stage only; Slice 5b/6) | **LIVE** | queries.ts:181-183 |
| `outcome_moments` | none direct | `storeSessionDigest` (LLM-stage only; Slice 5b/6) | **LIVE** | queries.ts:173-180 |
| `outcomes` | `getSessionOutcomes` | `storeSessionDigest` (LLM-stage only; Slice 5b/6) | **LIVE** | queries.ts:169-183, 270-281 |
| `projects` | `getDefaultProjectId` | seed-features.ts (indirectly) | **LIVE** | queries.ts:544-548 |
| `raw_events` | server.ts (LEFT JOIN for drill) | **Python `quire/db/writer.py`** (as of Slice 4 — intentional improvement; TS never wrote these to DB) | **LIVE** | writer.py:_write_all; server.ts (read) |
| `sessions` | `listSessions`, `getMostRecentSession`, `getSessionEndedAt` | **Python `quire/db/writer.py`** (as of Slice 4; TS `storeSessionDigest` demoted) | **LIVE** | writer.py:store_session_digest; queries.ts:71-74, 283-314 (demoted) |
| `sittings` | none direct | **Python `quire/db/writer.py`** (as of Slice 4; TS `storeSessionDigest` demoted) | **LIVE** | writer.py:_write_all; queries.ts:96-99 (demoted) |
| `topic_files` | none | none | **DEAD** | schema.ts:339-345; topic-era |
| `topic_patterns` | none | none | **DEAD** | schema.ts:394-405; topic-era |
| `topic_relations` | none | none | **DEAD** | schema.ts:349-353; topic-era |
| `topic_sessions` | none | none | **DEAD** | schema.ts:357-361; topic-era |
| `topic_skills` | none | none | **DEAD** | schema.ts:415-427; topic-era |
| `topics` | none | none (0 rows in DB) | **DEAD** | schema.ts:304-312; topic-era, 0 rows confirmed |
| `transition_moments` | none direct | `storeSessionDigest` (LLM-stage only; Slice 5b/6) | **LIVE** | queries.ts:161-166 |
| `transitions` | `getSessionTransitions` | `storeSessionDigest` (LLM-stage only; Slice 5b/6) | **LIVE** | queries.ts:155-167, 255-268 |

## Summary

- **LIVE (22):** activity_events, attention_state, chunks, feature_files, feature_sessions, features, feed_cache, moment_evidence, moment_relations, moments, narrative_arcs, narratives, normalized_events, outcome_files, outcome_moments, outcomes, projects, raw_events, sessions, sittings, transition_moments, transitions
- **DEAD (10):** brain_cards, brain_versions, insight_evidence, insights, topic_files, topic_patterns, topic_relations, topic_sessions, topic_skills, topics

All 10 DEAD tables are from the Topic-era subsystem excised 2026-07-04 (PRD v0.3.1). Confirmed by 0 DB rows and no callers in journal/src beyond schema.ts.

## Windowed Single-Writer Exception (Slice 6 → Slice 7)

`activity_events` has TWO active inserters during Slice 6:

1. **Python digest path** (`quire/journal/emit_events.py` → `emit_activity_events`): writes
   moment/transition/outcome/narrative events from session digestion. Python-owned as of Slice 6.

2. **TS MCP server** (`journal/src/mcp/server.ts`): writes instrumentation events
   (`brain_enter`, `brain_search`, etc.) as agents call MCP tools mid-session.

Both inserters are **append-only** (INSERT only; no UPDATE or DELETE). There is no shared
primary-key space or ordering dependency — inserts from both paths are conflict-free.
This is a documented, time-bounded exception to the single-writer rule.

**Slice-7 closes this exception**: the MCP server ports to Python, at which point
`quire/mcp/server.py` becomes the sole inserter for ALL `activity_events` rows.

Until Slice 7 lands, do NOT add any UPDATE or DELETE path touching `activity_events`
from Python — keep the table append-only on both sides.

## Slice 4 demoted entry points (TS digest paths)

1. `journal/src/cli/digest.ts::registerDigestCommand` — non-dry-run path prints deprecation and exits (dry-run still works; `--force-legacy` escape hatch bypasses deprecation)
2. `journal/src/web/server.ts::runScheduledDigest` — replaced with a no-op stub that logs a deprecation pointer (schedule UI is preserved for the settings toggle)
3. `journal/src/web/server.ts POST /api/brain/digest` — returns SSE error event with deprecation notice instead of running the pipeline
4. `journal/run-digest-agent.ts` (and its entry `journal/src/agents/digest/run.ts::digestWithAgent`) — prints deprecation notice pointing to `python3 -m quire.cli journal digest` and exits 1; `--force-legacy` escape hatch bypasses the gate for emergencies

Note: `raw_events` was previously never written to the DB by TS (the insert path was in-memory only). Python writes them in Slice 4 — this is an intentional improvement that makes the dashboard drill-view LEFT JOIN real.
