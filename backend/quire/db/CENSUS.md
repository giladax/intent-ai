# Table Census — journal Postgres (Slice 2, 2026-07-21)

Surveyed: `journal/src/storage/schema.ts` (32 tables; 22 LIVE + 10 DEAD), `journal/src/storage/queries.ts` (the query funnel), and all callers in `journal/src/`.

Verdict key: **LIVE** = has a production reader or writer; **DEAD** = defined in schema.ts but zero callers touching the DB table directly.

| Table | Readers | Writers | Verdict | Evidence (file:line) |
|-------|---------|---------|---------|----------------------|
| `activity_events` | `queryEvents`, `getFeatureObservations`, `getPendingObservations`, `loadFeatureContext` | `emitEvent`/`emitEvents`, `insertObservation`, `setObservationReviewStatus`, `updateObservationSummary`, `approveObservation`, `deleteSessionDigest` | **LIVE** | queries.ts:354-844; mcp/server.ts:489-576 |
| `attention_state` | `attention-store.ts` (SELECT) | `attention-store.ts` (INSERT/UPDATE), cli/infra.ts (CREATE IF NOT EXISTS) | **LIVE** | storage/attention-store.ts:26-38; cli/infra.ts:45-54 |
| `brain_cards` | none | none (0 rows in DB) | **DEAD** | schema.ts:374-390 only; 0 rows confirmed |
| `brain_versions` | none | none (0 rows in DB) | **DEAD** | schema.ts:364-370 only; 0 rows confirmed |
| `chunks` | `getChunkEvents` | `storeSessionDigest` | **LIVE** | queries.ts:103-109, 333-350 |
| `feature_files` | `getFeatureFileRows`, `loadFeatureContext`, server.ts | `addFeatureFile`, seed-features.ts | **LIVE** | queries.ts:565-588; seed-features.ts:288 |
| `feature_sessions` | `getFeatureSessions`, feed-composer.ts | `storeSessionDigest` (via deleteSessionDigest), seed-features.ts | **LIVE** | queries.ts:590-606; seed-features.ts:292 |
| `features` | `listFeatures`, `getFeatureById`, `loadFeatureContext` | `approveObservation` (UPDATE), seed-features.ts | **LIVE** | queries.ts:550-562, 827-843 |
| `feed_cache` | `feed-composer.ts` (SELECT) | `feed-composer.ts` (INSERT ON CONFLICT) | **LIVE** | web/feed-composer.ts:495-525; 1 row in DB |
| `insight_evidence` | none | none | **DEAD** | schema.ts:329-335 only; topic-era |
| `insights` | none | none | **DEAD** | schema.ts:317-325 only; topic-era, 0 rows |
| `moment_evidence` | `getMomentEvidence`, `getSessionMoments`, `getFeatureMoments` | `storeSessionDigest` | **LIVE** | queries.ts:136-138, 224-253, 619-640, 687-701 |
| `moment_relations` | none (join only — no direct read helper; Python consumers must JOIN through it) | `storeSessionDigest` (queries.ts:141-153) | **LIVE** | queries.ts:141-153 |
| `moments` | `getSessionMoments`, `getFeatureMoments`, `getMomentById` | `storeSessionDigest` | **LIVE** | queries.ts:113-138, 221-252, 611-640, 656-676 |
| `narrative_arcs` | none direct (joined via narratives) | `storeSessionDigest` | **LIVE** | queries.ts:193-197 |
| `narratives` | `getSessionNarrative`, `listSessions` | `storeSessionDigest` | **LIVE** | queries.ts:187-191, 204-219, 283-293 |
| `normalized_events` | `getChunkEvents`, server.ts raw_events join | `storeSessionDigest` | **LIVE** | queries.ts:83-93, 333-350 |
| `outcome_files` | none direct | `storeSessionDigest` | **LIVE** | queries.ts:181-183 |
| `outcome_moments` | none direct | `storeSessionDigest` | **LIVE** | queries.ts:173-180 |
| `outcomes` | `getSessionOutcomes` | `storeSessionDigest` | **LIVE** | queries.ts:169-183, 270-281 |
| `projects` | `getDefaultProjectId` | seed-features.ts (indirectly) | **LIVE** | queries.ts:544-548 |
| `raw_events` | server.ts (LEFT JOIN for drill) | `storeSessionDigest` (NOT CURRENTLY — insert path present but commented raw events) | **LIVE** | server.ts:1327 (read); schema.ts defines it, queries.ts INSERT path omitted but table used in server |
| `sessions` | `listSessions`, `getMostRecentSession`, `getSessionEndedAt` | `storeSessionDigest`, `deleteSessionDigest` | **LIVE** | queries.ts:71-74, 283-314 |
| `sittings` | none direct | `storeSessionDigest` | **LIVE** | queries.ts:96-99 |
| `topic_files` | none | none | **DEAD** | schema.ts:339-345; topic-era |
| `topic_patterns` | none | none | **DEAD** | schema.ts:394-405; topic-era |
| `topic_relations` | none | none | **DEAD** | schema.ts:349-353; topic-era |
| `topic_sessions` | none | none | **DEAD** | schema.ts:357-361; topic-era |
| `topic_skills` | none | none | **DEAD** | schema.ts:415-427; topic-era |
| `topics` | none | none (0 rows in DB) | **DEAD** | schema.ts:304-312; topic-era, 0 rows confirmed |
| `transition_moments` | none direct | `storeSessionDigest` | **LIVE** | queries.ts:161-166 |
| `transitions` | `getSessionTransitions` | `storeSessionDigest` | **LIVE** | queries.ts:155-167, 255-268 |

## Summary

- **LIVE (22):** activity_events, attention_state, chunks, feature_files, feature_sessions, features, feed_cache, moment_evidence, moment_relations, moments, narrative_arcs, narratives, normalized_events, outcome_files, outcome_moments, outcomes, projects, raw_events, sessions, sittings, transition_moments, transitions
- **DEAD (10):** brain_cards, brain_versions, insight_evidence, insights, topic_files, topic_patterns, topic_relations, topic_sessions, topic_skills, topics

All 10 DEAD tables are from the Topic-era subsystem excised 2026-07-04 (PRD v0.3.1). Confirmed by 0 DB rows and no callers in journal/src beyond schema.ts.

Note: `raw_events` is LIVE because `server.ts:1327` does a LEFT JOIN on it for the drill view, even though the insert path in queries.ts does not currently write raw events to the DB (it passes them in-memory). The table is queryable.
