# Activity Event Backbone Implementation

> Parent: [Activity Event Backbone](activity-event-backbone.md)

The Activity Event Backbone Implementation is the concrete wiring that makes activity event tracking live in the intent-ai system. It begins with the `ActivityEvent` type defined in `src/adapters/types.ts`, which serves as the shared contract that all other components — schema, storage, pipeline, CLI, and observation layer — depend on. The pipeline flow runs through `orchestrator.ts`, which calls `emitEvents` and `buildSessionEvents` from `src/storage/queries.ts` to persist and build events after session processing. The `activity_events` table is created via a migration that adds 11 indexes, and the end-to-end health of the pipeline is validated by running `intent events` from the CLI — a response of 'No events found' confirms the table exists and the pipeline is wired correctly. The observation layer uses `src/llm/client.ts` for LLM-driven event analysis. A critical operational constraint is that orchestrator tests must mock all storage and DB imports (`emitEvents`, `buildSessionEvents`, and `getClient` from `connection.js`) — any new import added to `orchestrator.ts` that touches storage will attempt a real DB connection in tests if not mocked, causing the entire test suite to regress.

## structure

- The `ActivityEvent` type in `src/adapters/types.ts` is the foundational shared contract — it was committed first to unblock parallel subagent work on schema, storage, pipeline wiring, CLI, and observation layer. All other components depend on this type; changes to it ripple everywhere.

## constraint

- The `activity_events` table requires 11 indexes as part of its migration — this is not optional. The index count reflects the query patterns the event backbone must support (filtering by session, type, timestamp, etc.) and must not be reduced without understanding downstream query performance implications.

## behavior

- The pipeline emits activity events through `orchestrator.ts` calling `emitEvents` and `buildSessionEvents` from `src/storage/queries.ts`, plus `getClient` from `connection.js`. All three must be present and mocked in orchestrator tests for the pipeline to function correctly in both production and test environments.

## Files

- `src/adapters/types.ts`
- `src/cli/index.ts`
- `src/llm/client.ts`
- `src/pipeline/orchestrator.ts`
- `src/storage/queries.ts`
- `tests/pipeline/orchestrator.test.ts`

## Sessions

- Jun 19: The developer set out to design and implement an activity event backbone for the Intent-AI execut... (26 moments)
