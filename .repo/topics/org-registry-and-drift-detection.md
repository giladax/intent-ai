# Org Registry and Drift Detection

> Children: [Drift Detection Spec Format](drift-detection-spec-format.md)

The Org Registry is Brain's authoritative map of the PRD↔Spec↔Code alignment graph for an organization. It exists because Brain's core value proposition — detecting when code drifts from specs, or specs drift from PRDs — requires a single, queryable source of truth that knows which PRDs govern which repos and which specs. Rather than pulling PRDs from a separate product management system at query time, PRDs are stored in git alongside specs and code. This repo-native approach collapses what would otherwise be a cross-system comparison problem into a single-repository traversal, making alignment detection tractable. The registry itself is intentionally narrow: it tracks PRDs and repos as first-class entities identified by slug IDs, with specs, teams, people, and Slack channels planned as future additions. External system connections (e.g., which Slack channel maps to which team) are explicitly out of scope for the registry and belong in Brain's own config or database. Drift detection — the process of comparing the current state of code/specs against their governing PRDs — is covered in detail in the child Drift Detection Spec Format document.

## structure

- Registry entities use slug IDs. PRDs and repos are the first-class entities in the current schema. Specs, teams, people, and Slack channels are designed-for but deferred additions — the schema is intentionally extensible.

## decision

- PRDs are stored in git (repo-native) alongside specs and code, not in an external product management tool. This is the architectural choice that makes Brain's alignment detection feasible without cross-system API calls.

## risk

- Expanding the registry to include external system mappings (e.g., Slack channels) would violate the explicit boundary decision and couple Brain's core graph to operational config concerns — resist this pressure as the system grows.

## Files

- `/Users/giladkoch/dev/brain/.worktrees/faithful-memory/docs/superpowers/specs/2026-05-15-org-registry-drift-detection-design.md`

## Sessions

- May 15: The developer set out to make PRDs version-controlled and repo-native, enabling Brain to detect a... (18 moments)
- May 21: The developer proposed a two-layer model architecture distinguishing observed facts from derived ... (5 moments)
- Apr 23: The developer set out to do a competitive evaluation of Brain against the entireio/cli repo, whic... (24 moments)
