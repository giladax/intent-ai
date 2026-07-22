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

## Single-Writer: activity_events (closed as of Slice 7)

`activity_events` is now **Python-only**. The dual-writer window that existed during Slice 6
(TS MCP server + Python digest path both inserting) is closed.

Python owns both insert paths:

1. **Session digest path** (`quire/journal/emit_events.py` → `emit_activity_events`): writes
   moment/transition/outcome/narrative events from session digestion.

2. **MCP instrumentation path** (`quire/mcp/server.py` → `emit_mcp_read_event`): writes
   `mcp:{tool}` events for every agent brain_* call.

Both are append-only (INSERT only; no UPDATE or DELETE). The TS MCP server
(`journal/src/mcp/server.ts`) is preserved as a runnable fallback but is no longer
the active MCP server — root `.mcp.json` now points to `python3 -m quire.cli mcp`.

## Slice 4 demoted entry points (TS digest paths)

1. `journal/src/cli/digest.ts::registerDigestCommand` — non-dry-run path prints deprecation and exits (dry-run still works; `--force-legacy` escape hatch bypasses deprecation)
2. `journal/src/web/server.ts::runScheduledDigest` — replaced with a no-op stub that logs a deprecation pointer (schedule UI is preserved for the settings toggle)
3. `journal/src/web/server.ts POST /api/brain/digest` — returns SSE error event with deprecation notice instead of running the pipeline
4. `journal/run-digest-agent.ts` (and its entry `journal/src/agents/digest/run.ts::digestWithAgent`) — prints deprecation notice pointing to `python3 -m quire.cli journal digest` and exits 1; `--force-legacy` escape hatch bypasses the gate for emergencies

Note: `raw_events` was previously never written to the DB by TS (the insert path was in-memory only). Python writes them in Slice 4 — this is an intentional improvement that makes the dashboard drill-view LEFT JOIN real.

## Slice 8b — Feed composition completed (2026-07-22)

**32 routes fully ported** as of Slice 8. The `GET /api/feed` route was the remaining gap:
it was a skeleton returning hardcoded empty JSON. Slice 8b completes it.

**1 (feed) completed in Slice 8b:**
- `backend/quire/journal/feed.py` — full port of `journal/src/web/feed-composer.ts` (633 lines)
  - Deterministic core: `compute_heat_score`, `rank_trending`, `deduplicate_trending`,
    `build_fallback_story_headline`, `build_fallback_lede_headline`, `build_fallback_lede_fallback_text`,
    `build_fallback_deep`, `filter_citations`, `contains_banned_words`, `is_cache_stale`
  - DB layer: `query_trending_inputs`, `query_feature_evidence` (SQL parity with TS)
  - LLM composition: `compose_feed_editorial` (up to 3 Sonnet calls — 1 lede + top 2 stories)
    with voice-rule guard (banned-word fallback) and citation validation (`filter_citations`)
  - Cache: `get_feed_or_compose`, `get_cached_feed`, `set_cached_feed` with 1-hour TTL,
    5-min minimum, degraded-compose fast-expiry; `threading.Lock` in-flight dedup
- `backend/quire/cli.py`: archive raw `.jsonl` to `backend/.intent/raw-sessions/` after
  successful digest (failure-safe, skip-if-same-size, mirrors TS `archiveRawSession`)
- `backend/tests/test_feed.py`: 63 unit tests (deterministic core + canned-LLM offline)
- `backend/tests/test_archive_gap.py`: 10 unit tests (archive semantics; includes CLI step-0 ordering test)

**feed_cache table**: now Python-owned (read + write via `get_cached_feed`/`set_cached_feed`).
Update to the table census above: `feed_cache` writer is now `backend/quire/journal/feed.py`.

## U0 — session_checks (2026-07-22)

**NEW TABLE** — first schema addition post-Drizzle freeze (`ts-backend-final`).

| Table | Readers | Writers | Verdict | Evidence |
|-------|---------|---------|---------|----------|
| `session_checks` | `quire.links.LinkStore.links_for_check`, `links_for_session` | `quire.links.LinkStore.upsert` / `upsert_many` | **LIVE** | backend/quire/links.py |

**Schema bootstrap:** `quire.links.ensure_table_exists(engine)` runs
`CREATE TABLE IF NOT EXISTS session_checks` idempotently. This is the
pre-Alembic bootstrap path; Alembic adoption (see `backend/README.md`
"Schema changes") should formalize it as `migrations/001_session_checks.py`.

**Single-writer:** `quire.links` is the sole writer. No TS path exists.

**Columns:**
- `id` TEXT PK (UUID)
- `session_id` TEXT NOT NULL (index)
- `workspace` TEXT NOT NULL (index)
- `pr_number` INTEGER NULL (index)
- `base_sha` TEXT NOT NULL
- `head_sha` TEXT NOT NULL
- `kind` TEXT NOT NULL — "trailer" | "attached" | "inferred"
- `confidence` REAL NOT NULL
- `evidence` TEXT NOT NULL — commit SHA (trailer) or session_id (yaml)

**Unique constraint:** `(session_id, workspace, evidence)` — re-ingesting the
same commit range is idempotent.

## O0 — org tables (2026-07-22)

**THREE NEW TABLES** — org platform layer.

| Table | Readers | Writers | Verdict | Evidence |
|-------|---------|---------|---------|----------|
| `orgs` | `quire.org_store.OrgStore.get_org` | `quire.org_store.OrgStore.seed` | **LIVE** | backend/quire/org_store.py |
| `org_repos` | `quire.org_store.OrgStore.list_repos`, `get_repo_card_data` | `quire.org_store.OrgStore.seed` / `add_repo` / `update_repo_status` / `remove_repo` (O1) | **LIVE** | backend/quire/org_store.py |
| `org_channels` | (reserved for O5 delivery) | (reserved for O5) | **LIVE** | backend/quire/db/org_models.py |

**Schema bootstrap:** `quire.db.org_models.ensure_org_tables(engine)` runs
`CREATE TABLE IF NOT EXISTS` idempotently for all three. Called from
`OrgStore.__init__()` and from the FastAPI app startup path.

**Single-writer:** `quire.org_store.OrgStore` is the sole writer. No TS path exists.

**Seeding:** `seed_demo_org(store)` is called at app startup (quire/api.py) to
idempotently populate the "Quire" org with 6 dogfood repo residents:
intent-ai, intent-ai-live, refund-agent, pydantic, telegram, quire-brain.
quire-brain is frozen (read_only=True, status="frozen").

**Columns: orgs**
- `id` TEXT PK (stable slug, e.g. "quire")
- `name` TEXT NOT NULL

**Columns: org_repos**
- `id` TEXT PK (workspace slug)
- `org_id` TEXT NOT NULL (index)
- `workspace` TEXT NOT NULL
- `display_name` TEXT NOT NULL
- `github_remote` TEXT NULL (nullable for local-only repos)
- `status` TEXT NOT NULL — "active" | "fixture" | "frozen"
- `read_only` BOOLEAN NOT NULL
- `repository` TEXT NULL — alignment store's repository key when it differs from workspace name; NULL means workspace name is the key (e.g. "company/refund-agent" for the refund-agent resident)

**Columns: org_channels**
- `id` TEXT PK (UUID)
- `org_id` TEXT NOT NULL (index)
- `transport` TEXT NOT NULL — "telegram" | "slack"
- `config` JSONB NOT NULL
- `purposes` JSONB NOT NULL

## Drizzle/schema ownership (Slice 9 — CLOSED)

The TS backend (`journal/`) is deleted as of Slice 9 (2026-07-22). The Postgres schema is
frozen as inherited from Drizzle migrations at git tag `ts-backend-final`. No Drizzle is present
in the repo. Any future schema change starts by adopting Alembic — see `backend/README.md`
"Schema changes" section.
