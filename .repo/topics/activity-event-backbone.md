# Activity Event Backbone

The Activity Event Backbone is the central nervous system of the intent-ai platform: a single append-only event stream (the `activity_events` table) that serves as the unified source of truth for everything the system knows — raw coding facts, LLM-derived observations, session metadata, and system signals. The architecture follows a deliberate data flow: Facts (raw events from pipeline) → Observations (LLM-generated `system:observation` events) → Memory → Scaffolds → Better agent sessions → more events. Rather than scattering state across normalized relational tables, every meaningful occurrence is an event with a freeform `category` string (e.g. `coding:struggle`, `learned:skill`), a `tags` array, denormalized session context (repo, branch, worktree), and an embedding column for pgvector-powered RAG retrieval. This design deliberately layers on top of the existing `normalized_events` pipeline storage rather than replacing it — `activity_events` is a higher-level stream capturing session-derived and system-level events. The observation layer is LLM-driven and open-ended: the LLM looks at a window of events and reports what it sees as new `system:observation` events with self-assigned tags, deliberately avoiding brittle hardcoded pattern-detection rules. The result is a schema that is simultaneously a queryable audit log, a semantic search index, and the raw material for all memory and scaffolding features. Implementation details (schema, ingestion, query patterns) are covered in the child spec: Activity Event Backbone Implementation.

## structure

- The `ActivityEvent` type in `src/adapters/types.ts` is the foundational shared contract — it was committed first to unblock parallel subagent work on schema, storage, pipeline wiring, CLI, and observation layer. All other components depend on this type; changes to it ripple everywhere.

## constraint

- The `category` field on `activity_events` is plain TEXT with no enum or CHECK constraint. New event types (e.g. `coding:struggle`, `learned:skill`) are added by convention, not migration. Never add a database-level enum or constraint on this column.
- Events must be self-contained and queryable without joins. `repo`, `branch`, and `worktree` are top-level denormalized columns — not foreign keys to a sessions table. This is required to support parallel worktree sessions and to enable filter-first RAG queries that scope by context before running nearest-neighbor search.

## decision

- The activity event stream is the single source of truth for the entire system. One table, everything is an event — facts, LLM observations, session signals, and system events all flow through `activity_events`. This is the locked-in architectural north star and should not be fragmented into separate stores.

## behavior

- The pipeline emits activity events through `orchestrator.ts` calling `emitEvents` and `buildSessionEvents` from `src/storage/queries.ts`, plus `getClient` from `connection.js`. All three must be present and mocked in orchestrator tests for the pipeline to function correctly in both production and test environments.

## Files

- `docs/superpowers/specs/2026-06-21-activity-event-backbone-design.md`
- `src/adapters/types.ts`
- `src/storage/schema.ts`
- `src/adapters/types.ts`
- `src/cli/index.ts`
- `src/llm/client.ts`
- `src/pipeline/orchestrator.ts`
- `src/storage/queries.ts`
- `tests/pipeline/orchestrator.test.ts`
