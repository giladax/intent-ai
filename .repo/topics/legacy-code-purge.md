# Legacy Code Purge

> Parent: [Intent Pipeline V2](intent-pipeline-v2.md)

The Legacy Code Purge is a completed, irreversible architectural migration that eliminated all signal-based session infrastructure in favor of the turn-based sessions-v2 system. Prior to this purge, the codebase contained a parallel session model built around 'signals' — a SessionStory model, a session_extractor.py module, GET /signals and GET /signals/{id} REST endpoints, and a fetchSignals() frontend client function. These were removed wholesale across every layer (backend models, API routing, frontend client, and test suite) as part of the Intent Pipeline V2 migration to turn-based architecture. The purge was validated by a clean 167-test pass with zero failures, confirming no regressions. Any new developer encountering references to signals, SessionStory, or session_extractor should treat them as permanently retired — re-introducing any of these constructs would contradict the foundational architectural decision that the turn-based system is the sole source of truth for session state.

## constraint

- Do NOT re-introduce session_extractor.py, the SessionStory model, GET /signals or GET /signals/{id} endpoints, or fetchSignals() in any form. These are permanently retired artifacts of a superseded architecture.

## behavior

- After the purge, the system passes 167 tests with 0 failures — this is the baseline health state. Any regression to this count or new failures related to session/signal handling should be treated as a sign that legacy constructs have leaked back in.

## Files

- `frontend/src/lib/api.ts`
- `src/brain/api.py`
- `src/brain/extractors/session_extractor.py`
- `src/brain/models.py`
- `tests/test_api.py`
- `tests/test_models.py`

## Sessions

- May 15: The developer set out to make PRDs version-controlled and repo-native, enabling Brain to detect a... (18 moments)
- May 21: The developer proposed a two-layer model architecture distinguishing observed facts from derived ... (5 moments)
- Apr 23: The developer set out to do a competitive evaluation of Brain against the entireio/cli repo, whic... (24 moments)
