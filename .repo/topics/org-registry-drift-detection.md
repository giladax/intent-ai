# Org Registry & Drift Detection

The Org Registry & Drift Detection system is a foundational concept for tracking organizational structure and identifying when real-world state has diverged from the recorded or expected state. It exists to give the system a reliable source of truth about which organizations (orgs) exist, their configurations, and their relationships — and to surface when that truth has become stale or inconsistent. Drift detection specifically monitors for changes between what the registry believes to be true and what is actually observed, enabling automated or human-driven reconciliation. Without this system, downstream processes that depend on org identity, permissions, or configuration would silently operate on outdated data.

## structure

- DriftFindings are enriched with session context by joining TurnAnalysis.decisions[] and TurnAnalysis.rejections[] via turns.files_changed → DriftFinding.file_path — no new data collection is needed to distinguish intentional deviations from genuine drift.
- Registry entities use slug IDs. PRDs and repos are the first-class entities in the current schema. Specs, teams, people, and Slack channels are designed-for but deferred additions — the schema is intentionally extensible.

## constraint

- Phase 1 drift detection is strictly Spec↔Code only. PRD↔Code comparison must never be built directly (always inferred), and single-commit-vs-full-PRD comparison is explicitly excluded as too noisy.

## risk

- Expanding the registry to include external system mappings (e.g., Slack channels) would violate the explicit boundary decision and couple Brain's core graph to operational config concerns — resist this pressure as the system grows.

## interface

- Requirement IDs in specs (e.g., REQ-001) are the primary join key between spec content and DriftFindings — any tooling that generates, parses, or displays specs must preserve these IDs as stable, unique identifiers.

## Files

- `/Users/giladkoch/dev/brain/.worktrees/faithful-memory/docs/superpowers/specs/2026-05-15-org-registry-drift-detection-design.md`

## Sessions

- May 15: The developer set out to make PRDs version-controlled and repo-native, enabling Brain to detect a... (18 moments)
- May 21: The developer proposed a two-layer model architecture distinguishing observed facts from derived ... (5 moments)
- Apr 5: The developer assigned the AI to implement Task 10 of the Faithful Memory Foundation plan — loop ... (10 moments)
- Apr 23: The developer set out to do a competitive evaluation of Brain against the entireio/cli repo, whic... (24 moments)
