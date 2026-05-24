# brain — Brain

> This file is the entry point to the project's knowledge graph.
> Each spec below is a concept in the codebase with accumulated insights from development sessions.
> Use the file index at the bottom to find which spec covers any source file.

## Dashboard & CLI

- [Dashboard & CLI](topics/dashboard-cli.md) — The Dashboard & CLI layer provides the primary human-facing interfaces for interacting with the s... (7 files)

## Data Collection & Ingestion

- [Data Collection & Ingestion](topics/data-collection-ingestion.md) — Data Collection & Ingestion is the entry point of the data pipeline — responsible for acquiring r... (6 files)

## Intent Pipeline V2

- [Intent Pipeline V2](topics/intent-pipeline-v2.md) — Intent Pipeline V2 is a ground-up replacement of the legacy Signal→Fact→Thread processing chain w... (17 files)
  - [Legacy Code Purge](topics/legacy-code-purge.md) — The Legacy Code Purge is a completed, irreversible architectural migration that eliminated all si... (6 files)
  - [V2 Plan Grounding and Documentation](topics/v2-plan-grounding-and-documentation.md) — Before writing any V2 pipeline plan, the process requires grounding in the actual codebase — read... (3 files)

## Org Registry & Drift Detection

- [Org Registry & Drift Detection](topics/org-registry-drift-detection.md) — The Org Registry & Drift Detection system is a foundational concept for tracking organizational s... (1 files)

## File Index

> Find which spec covers a source file. Path shows the spec hierarchy.

| File | Spec |
|------|------|
| `/Users/giladkoch/.brain/product.md` | Dashboard & CLI |
| `/Users/giladkoch/dev/brain/.worktrees/faithful-memory/docs/plans/2026-05-15-org-registry-drift-detection.md` | Dashboard & CLI |
| `/Users/giladkoch/dev/brain/.worktrees/faithful-memory/docs/plans/2026-05-21-intent-pipeline-v2.md` | Intent Pipeline V2 > V2 Plan Grounding and Documentation |
| `/Users/giladkoch/dev/brain/.worktrees/faithful-memory/docs/superpowers/specs/2026-05-15-org-registry-drift-detection-design.md` | Org Registry & Drift Detection |
| `/Users/giladkoch/dev/brain/.worktrees/faithful-memory/src/brain/models.py` | Intent Pipeline V2 |
| `/Users/giladkoch/dev/brain/.worktrees/faithful-memory/src/brain/pipeline.py` | Intent Pipeline V2 |
| `/Users/giladkoch/dev/brain/.worktrees/faithful-memory/tests/eval/dataset.py` | Intent Pipeline V2 > V2 Plan Grounding and Documentation |
| `/Users/giladkoch/dev/brain/.worktrees/faithful-memory/tests/eval/ground_truth_2026_04_11.json` | Intent Pipeline V2 > V2 Plan Grounding and Documentation |
| `docs/plans/2026-04-24-pipeline-visibility.md` | Dashboard & CLI |
| `docs/plans/2026-05-16-product-view-markdown.md` | Dashboard & CLI |
| `docs/superpowers/specs/2026-04-24-pipeline-visibility-design.md` | Dashboard & CLI |
| `frontend/src/lib/api.ts` | Intent Pipeline V2 > Legacy Code Purge |
| `frontend/src/pages/SessionFeed.tsx` | Dashboard & CLI |
| `src/brain/api.py` | Intent Pipeline V2 > Legacy Code Purge |
| `src/brain/cli.py` | Dashboard & CLI |
| `src/brain/collectors/claude_collector.py` | Data Collection & Ingestion |
| `src/brain/collectors/entireio_collector.py` | Data Collection & Ingestion |
| `src/brain/constants.py` | Intent Pipeline V2 |
| `src/brain/db.py` | Intent Pipeline V2 |
| `src/brain/extractors/session_extractor.py` | Intent Pipeline V2 > Legacy Code Purge |
| `src/brain/loop_detection.py` | Intent Pipeline V2 |
| `src/brain/models.py` | Intent Pipeline V2 > Legacy Code Purge |
| `src/brain/pipeline.py` | Intent Pipeline V2 |
| `tests/fixtures/claude_session_sample.jsonl` | Data Collection & Ingestion |
| `tests/test_api.py` | Intent Pipeline V2 > Legacy Code Purge |
| `tests/test_claude_collector_cursor.py` | Data Collection & Ingestion |
| `tests/test_claude_collector.py` | Data Collection & Ingestion |
| `tests/test_db.py` | Intent Pipeline V2 |
| `tests/test_entireio_collector.py` | Data Collection & Ingestion |
| `tests/test_loop_detection.py` | Intent Pipeline V2 |
| `tests/test_models.py` | Intent Pipeline V2 > Legacy Code Purge |
