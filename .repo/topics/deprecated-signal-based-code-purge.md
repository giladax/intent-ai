# deprecated signal-based code purge

All signal-based legacy code was deliberately purged as part of the migration to the turn-based/sessions-v2 architecture. Deleted artifacts include session_extractor.py, the SessionStory model, GET /signals and GET /signals/{id} API endpoints, fetchSignals() and dead types from the frontend, and all associated tests. The full test suite passes with 167 tests and 0 failures after the purge.

## structure

- The purge touched 5+ files across backend models, API layer, frontend, and test suite — the signal-based system was fully cross-cutting and is now fully removed.

## constraint

- Do not re-introduce session_extractor.py, SessionStory model, GET /signals endpoints, or fetchSignals() — these were intentionally deleted and must not be restored.

## decision

- The sessions-v2/turn-based system is now the sole architectural truth — all signal-based endpoints, models, extractors, and frontend code were deleted rather than maintained as legacy.

## behavior

- After the purge, the full test suite runs 167 tests with 0 failures — this is the new baseline for the codebase.

## Files

- `frontend/src/lib/api.ts` — fetchSignals() and dead signal types removed
- `src/brain/api.py` — GET /signals and GET /signals/{id} endpoints removed
- `src/brain/extractors/session_extractor.py` — DELETED — was the signal-based session extractor
- `src/brain/models.py` — SessionStory model removed; turn-based models remain
- `tests/test_api.py` — All deprecated /signals endpoint tests removed
- `tests/test_models.py` — SessionStory import and test_session_story_creation test removed

## Evidence

- Apr 23: The developer set out to do a competitive evaluation of Brain against the entireio/cli repo, whic... (24 moments)

## Related

- [tech stack and architecture decisions](tech-stack-and-architecture-decisions.md)
- [intent pipeline v2 architecture](intent-pipeline-v2-architecture.md)
