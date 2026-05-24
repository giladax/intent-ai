# V2 Plan Grounding and Documentation

> Parent: [Intent Pipeline V2](intent-pipeline-v2.md)

Before writing any V2 pipeline plan, the process requires grounding in the actual codebase — reading models.py, ground_truth_2026_04_11.json, dataset.py, and all core pipeline files first. This is a deliberate rejection of spec-only planning: the developer explicitly required that plans be validated against real past session data, not just theoretical design. Once grounded, the resulting plan document is written to docs/plans/ using a date-prefixed filename (e.g., 2026-05-21-intent-pipeline-v2.md), a convention established by at least 7 prior plan files in that directory. The canonical test artifacts — tests/eval/ground_truth_2026_04_11.json and tests/eval/dataset.py — serve as the empirical validation source throughout both planning and implementation, ensuring that pipeline behavior is measured against real session data rather than synthetic fixtures.

## structure

- Plan documents live in docs/plans/ with date-prefixed filenames (YYYY-MM-DD-<name>.md). At least 7 prior plans exist there, making this a stable, established convention rather than a one-off choice.

## interface

- tests/eval/ground_truth_2026_04_11.json and tests/eval/dataset.py are the canonical empirical validation artifacts — any pipeline behavior claim in a plan must be verifiable against these real-session fixtures.

## Files

- `/Users/giladkoch/dev/brain/.worktrees/faithful-memory/docs/plans/2026-05-21-intent-pipeline-v2.md`
- `/Users/giladkoch/dev/brain/.worktrees/faithful-memory/tests/eval/dataset.py`
- `/Users/giladkoch/dev/brain/.worktrees/faithful-memory/tests/eval/ground_truth_2026_04_11.json`

## Sessions

- May 15: The developer set out to make PRDs version-controlled and repo-native, enabling Brain to detect a... (18 moments)
- May 21: The developer proposed a two-layer model architecture distinguishing observed facts from derived ... (5 moments)
- Apr 23: The developer set out to do a competitive evaluation of Brain against the entireio/cli repo, whic... (24 moments)
