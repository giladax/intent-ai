# Intent Pipeline V2

> Children: [Legacy Code Purge](legacy-code-purge.md), [V2 Plan Grounding and Documentation](v2-plan-grounding-and-documentation.md)

Intent Pipeline V2 is a ground-up replacement of the legacy Signal→Fact→Thread processing chain with a two-layer architecture: Observed Events (raw captured session data) feeding into derived models (LLM-interpreted IntentSpans and product memory). The core insight driving this redesign is that product value comes almost entirely from derived models — the system's ability to reason about what a developer was trying to accomplish — not from raw event capture. The pipeline is implemented as 9 sequentially validated tasks, built bottom-up with a unit-test-first strategy anchored to real past session data (ground_truth_2026_04_11.json and real session fixtures). No task is considered complete without empirical validation against that ground truth. Child specs cover V2 Plan Grounding and Documentation (the detailed 9-task plan and its rationale) and Legacy Code Purge (removal of the old Signal/Fact/Thread models and pipeline).

## constraint

- Every implementation step must be validated against real past session data — ground_truth_2026_04_11.json and real session fixtures — before it is considered done. Theoretical correctness or passing synthetic tests is insufficient. This is a hard project rule, not a preference.

## decision

- The pipeline replaces Signal→Fact→Thread with Observed Events→IntentSpan→product memory specifically to make the architectural boundary between raw data and LLM interpretation explicit and enforceable. The old chain blurred this boundary, making it hard to reason about what was captured vs. what was inferred.

## interface

- IntentSpan is the primary derived model and the key output contract of the pipeline. Downstream consumers (product memory, any UI or API layer) depend on IntentSpan's schema. Changes to IntentSpan's fields or semantics are breaking changes that ripple through all derived consumers.

## Files

- `/Users/giladkoch/dev/brain/.worktrees/faithful-memory/docs/plans/2026-05-21-intent-pipeline-v2.md`
- `/Users/giladkoch/dev/brain/.worktrees/faithful-memory/src/brain/models.py`
- `/Users/giladkoch/dev/brain/.worktrees/faithful-memory/src/brain/pipeline.py`
- _from [Legacy Code Purge](legacy-code-purge.md):_
  - `frontend/src/lib/api.ts`
  - `src/brain/api.py`
  - `src/brain/extractors/session_extractor.py`
  - `src/brain/models.py`
  - `tests/test_api.py`
  - `tests/test_models.py`
- _from [V2 Plan Grounding and Documentation](v2-plan-grounding-and-documentation.md):_
  - `/Users/giladkoch/dev/brain/.worktrees/faithful-memory/tests/eval/dataset.py`
  - `/Users/giladkoch/dev/brain/.worktrees/faithful-memory/tests/eval/ground_truth_2026_04_11.json`

## Sessions

- May 15: The developer set out to make PRDs version-controlled and repo-native, enabling Brain to detect a... (18 moments)
- May 21: The developer proposed a two-layer model architecture distinguishing observed facts from derived ... (5 moments)
- Apr 23: The developer set out to do a competitive evaluation of Brain against the entireio/cli repo, whic... (24 moments)
