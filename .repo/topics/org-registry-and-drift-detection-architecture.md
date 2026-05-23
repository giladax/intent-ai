# org registry and drift detection architecture

Brain's org registry maps PRDs, specs, and code as first-class entities with slug IDs, enabling alignment detection across all three layers. The design uses YAML frontmatter with typed requirement IDs (REQ-001) and explicit code links in specs. Drift detection is scoped to Spec↔Code only in Phase 1; PRD↔Code is always inferred, never direct. Session memory (TurnAnalysis decisions/rejections) enriches drift findings via a join on turns.files_changed → DriftFinding.file_path.

## structure

- TurnAnalysis already captures decisions[] and rejections[], providing a join path via turns.files_changed → DriftFinding.file_path to enrich drift findings with session context and avoid flagging intentional deviations as drift.
- The spec incorporates session enrichment, drift_fact_links, hierarchical LLM strategy, and a LangGraph pipeline — all locked in before implementation planning began.

## constraint

- Phase 1 drift detection is Spec↔Code only. PRD↔Code must never be built directly — it is always inferred. Single-commit-vs-full-PRD comparison is too noisy and was rejected.

## decision

- Schema-driven approach chosen over freeform LLM parsing: YAML frontmatter, typed requirement IDs (REQ-001), and explicit code links in specs are the canonical format for intent tracking.
- The registry maps the PRD↔Spec↔Code graph only. External system mappings (Slack channels, etc.) belong in Brain's config/database, not the registry.
- PRDs are moved from Google Drive into git to unify all three layers (PRD, spec, code) in a single repo, enabling Brain's alignment detection without cross-system comparison.

## Files

- `/Users/giladkoch/dev/brain/.worktrees/faithful-memory/docs/plans/2026-05-15-org-registry-drift-detection.md` — EDD-first implementation plan for org registry and drift detection
- `/Users/giladkoch/dev/brain/.worktrees/faithful-memory/docs/superpowers/specs/2026-05-15-org-registry-drift-detection-design.md` — Design spec for org registry and drift detection, reviewed through three cycles and declared ready to implement

## Evidence

- May 15: The developer set out to make PRDs version-controlled and repo-native, enabling Brain to detect a... (18 moments)

## Related

- [digestion pipeline](digestion-pipeline.md)
- [storage schema](storage-schema.md)
- [eval-driven development](eval-driven-development.md)
