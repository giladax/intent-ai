# intent pipeline v2 architecture

The next version of the brain pipeline replaces the Signal→Fact→Thread model with a two-layer architecture: Observed Events (raw captured facts) and IntentSpan (LLM-derived interpretations). The pipeline chain becomes Observed Events→IntentSpan→product memory, implemented bottom-up across 9 structured tasks, each validated against real past session data before being considered complete.

## structure

- The two-layer model separates Observed Events (raw facts the system captures) from IntentSpan (LLM-derived interpretations) — product value comes almost entirely from the derived layer.

## constraint

- Each of the 9 implementation tasks must be validated against real past session data before being considered complete — theoretical correctness alone is insufficient.

## decision

- The pipeline model was redesigned from Signal→Fact→Thread to Observed Events→IntentSpan→product memory, establishing a hard separation between raw observed data and LLM-derived interpretations.
- The pipeline model was redesigned from Signal→Fact→Thread to Observed Events→IntentSpan→product memory, establishing a hard separation between raw observed data and LLM-derived interpretations.
- The plan was grounded in the actual codebase (models.py, pipeline.py, dataset.py, ground_truth_2026_04_11.json) before being written — planning from spec alone was rejected.

## behavior

- Implementation follows a strict bottom-up sequence — lower layers (Observed Events) must be built and tested before upper layers (IntentSpan, product memory) are implemented.

## interface

- The plan document lives at docs/plans/ following the existing naming convention (date-prefixed markdown), consistent with 7 prior plan files already in that directory.

## Files

- `/Users/giladkoch/dev/brain/.worktrees/faithful-memory/docs/plans/2026-05-21-intent-pipeline-v2.md` — Primary deliverable — the committed Intent Pipeline V2 plan defining the 9-task bottom-up implementation sequence
- `/Users/giladkoch/dev/brain/.worktrees/faithful-memory/src/brain/models.py` — Current model definitions that the V2 architecture replaces — read during codebase grounding
- `/Users/giladkoch/dev/brain/.worktrees/faithful-memory/src/brain/pipeline.py` — Current pipeline implementation that V2 supersedes — read during codebase grounding
- `/Users/giladkoch/dev/brain/.worktrees/faithful-memory/tests/eval/dataset.py` — Eval dataset loader — read during codebase grounding to understand existing test infrastructure
- `/Users/giladkoch/dev/brain/.worktrees/faithful-memory/tests/eval/ground_truth_2026_04_11.json` — Real past session data used as the empirical validation anchor for all 9 implementation tasks

## Evidence

- May 21: The developer proposed a two-layer model architecture distinguishing observed facts from derived ... (5 moments)

## Related

- [digestion pipeline](digestion-pipeline.md)
- [eval-driven development](eval-driven-development.md)
