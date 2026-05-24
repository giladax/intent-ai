# Drift Detection Spec Format

> Parent: [Org Registry and Drift Detection](org-registry-and-drift-detection.md)

The Drift Detection Spec Format defines how intent is captured and tracked in a machine-readable, schema-driven structure so that automated agents can compare what was specified against what was actually built. Each spec uses YAML frontmatter combined with typed requirement IDs (e.g., REQ-001) and explicit code links — this is a deliberate choice over freeform prose to enable deterministic parsing without relying on LLM interpretation of ambiguous text. The format exists because drift detection requires a stable, joinable anchor: requirements must be addressable by ID so that DriftFindings can reference them precisely, and code links must be explicit so the pipeline knows which files to diff against which requirements. Phase 1 scope is intentionally narrow — Spec↔Code comparison only — because PRD↔Code comparison is too noisy at the single-commit level and would produce false positives that erode developer trust. The format also anticipates the intentional-deviation problem: because TurnAnalysis already captures decisions[] and rejections[] from session history, drift findings can be enriched by joining on files_changed → DriftFinding.file_path, allowing the system to distinguish a genuine drift from a deliberate, documented deviation without requiring new data collection infrastructure.

## structure

- DriftFindings are enriched with session context by joining TurnAnalysis.decisions[] and TurnAnalysis.rejections[] via turns.files_changed → DriftFinding.file_path — no new data collection is needed to distinguish intentional deviations from genuine drift.

## constraint

- Phase 1 drift detection is strictly Spec↔Code only. PRD↔Code comparison must never be built directly (always inferred), and single-commit-vs-full-PRD comparison is explicitly excluded as too noisy.

## interface

- Requirement IDs in specs (e.g., REQ-001) are the primary join key between spec content and DriftFindings — any tooling that generates, parses, or displays specs must preserve these IDs as stable, unique identifiers.

## Files

- `/Users/giladkoch/dev/brain/.worktrees/faithful-memory/docs/superpowers/specs/2026-05-15-org-registry-drift-detection-design.md`

## Sessions

- May 15: The developer set out to make PRDs version-controlled and repo-native, enabling Brain to detect a... (18 moments)
- May 21: The developer proposed a two-layer model architecture distinguishing observed facts from derived ... (5 moments)
- Apr 23: The developer set out to do a competitive evaluation of Brain against the entireio/cli repo, whic... (24 moments)
