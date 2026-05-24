# brain — Brain

> This file is the entry point to the project's knowledge graph.
> Each spec below is a concept in the codebase with accumulated insights from development sessions.
> Use the file index at the bottom to find which spec covers any source file.

## Data Collection and Cursoring

- [Data Collection and Cursoring](topics/data-collection-and-cursoring.md) — The data collection layer ingests raw session data from external sources (e.g., Claude JSONL file... (6 files)
  - [Rejected Integrations](topics/rejected-integrations.md) — This document records data source integrations that were prototyped and explicitly rejected for B... (2 files)

## Intent Pipeline V2

- [Intent Pipeline V2](topics/intent-pipeline-v2.md) — Intent Pipeline V2 is a ground-up replacement of the legacy Signal→Fact→Thread processing chain w... (11 files)
  - [Legacy Code Purge](topics/legacy-code-purge.md) — The Legacy Code Purge is a completed, irreversible architectural migration that eliminated all si... (6 files)
  - [V2 Plan Grounding and Documentation](topics/v2-plan-grounding-and-documentation.md) — Before writing any V2 pipeline plan, the process requires grounding in the actual codebase — read... (3 files)

## Org Registry and Drift Detection

- [Org Registry and Drift Detection](topics/org-registry-and-drift-detection.md) — The Org Registry is Brain's authoritative map of the PRD↔Spec↔Code alignment graph for an organiz... (1 files)
  - [Drift Detection Spec Format](topics/drift-detection-spec-format.md) — The Drift Detection Spec Format defines how intent is captured and tracked in a machine-readable,... (1 files)

## Product View

- [Product View](topics/product-view.md) — The Product View is a markdown-based snapshot of the brain system's state, written to ~/.brain/pr... (7 files)
  - [Implementation Philosophy](topics/implementation-philosophy.md) — This codebase follows two interlocking principles that govern the order and validation of all fea... (1 files)
  - [Pipeline Visibility UI](topics/pipeline-visibility-ui.md) — Pipeline Visibility UI is a web view within the Product View that gives developers real-time obse... (3 files)

## File Index

> Find which spec covers a source file. Path shows the spec hierarchy.

| File | Spec |
|------|------|
| `/Users/giladkoch/.brain/product.md` | Product View |
| `/Users/giladkoch/dev/brain/.worktrees/faithful-memory/docs/plans/2026-05-15-org-registry-drift-detection.md` | Product View > Implementation Philosophy |
| `/Users/giladkoch/dev/brain/.worktrees/faithful-memory/docs/plans/2026-05-21-intent-pipeline-v2.md` | Intent Pipeline V2 > V2 Plan Grounding and Documentation |
| `/Users/giladkoch/dev/brain/.worktrees/faithful-memory/docs/superpowers/specs/2026-05-15-org-registry-drift-detection-design.md` | Org Registry and Drift Detection > Drift Detection Spec Format |
| `/Users/giladkoch/dev/brain/.worktrees/faithful-memory/src/brain/models.py` | Intent Pipeline V2 |
| `/Users/giladkoch/dev/brain/.worktrees/faithful-memory/src/brain/pipeline.py` | Intent Pipeline V2 |
| `/Users/giladkoch/dev/brain/.worktrees/faithful-memory/tests/eval/dataset.py` | Intent Pipeline V2 > V2 Plan Grounding and Documentation |
| `/Users/giladkoch/dev/brain/.worktrees/faithful-memory/tests/eval/ground_truth_2026_04_11.json` | Intent Pipeline V2 > V2 Plan Grounding and Documentation |
| `docs/plans/2026-04-24-pipeline-visibility.md` | Product View > Pipeline Visibility UI |
| `docs/plans/2026-05-16-product-view-markdown.md` | Product View |
| `docs/superpowers/specs/2026-04-24-pipeline-visibility-design.md` | Product View > Pipeline Visibility UI |
| `frontend/src/lib/api.ts` | Intent Pipeline V2 > Legacy Code Purge |
| `frontend/src/pages/SessionFeed.tsx` | Product View > Pipeline Visibility UI |
| `src/brain/api.py` | Intent Pipeline V2 > Legacy Code Purge |
| `src/brain/cli.py` | Product View |
| `src/brain/collectors/claude_collector.py` | Data Collection and Cursoring |
| `src/brain/collectors/entireio_collector.py` | Data Collection and Cursoring > Rejected Integrations |
| `src/brain/extractors/session_extractor.py` | Intent Pipeline V2 > Legacy Code Purge |
| `src/brain/models.py` | Intent Pipeline V2 > Legacy Code Purge |
| `tests/fixtures/claude_session_sample.jsonl` | Data Collection and Cursoring |
| `tests/test_api.py` | Intent Pipeline V2 > Legacy Code Purge |
| `tests/test_claude_collector_cursor.py` | Data Collection and Cursoring |
| `tests/test_claude_collector.py` | Data Collection and Cursoring |
| `tests/test_entireio_collector.py` | Data Collection and Cursoring > Rejected Integrations |
| `tests/test_models.py` | Intent Pipeline V2 > Legacy Code Purge |
