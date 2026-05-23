# Brain product scope and vision

Brain's scope expanded from 'developer memory' to 'organizational intelligence hub' — a cross-system analysis platform with slug IDs for PRDs, Slack channels, repos, and specs enabling dynamic analysis across all organizational signal sources. The immediate implementation starts with PRDs and repos as first-class entities, with Slack channels, specs, teams, and people accommodated later. Brain's core value proposition is alignment detection across PRD↔Spec↔Code layers.

## constraint

- Granular on-demand sync down to a single commit is foundational — no cron jobs or webhooks in the initial implementation.

## decision

- Initial implementation scopes to PRDs and repos as first-class entities with slug IDs; Slack channels, specs, teams, and people are deferred to later phases.
- EDD-first implementation philosophy requires importing or mocking pre-existing work and evaluating system expectations against gold test cases before building new features.
- Brain's long-term scope is a cross-system analysis platform with slug IDs across PRDs, Slack channels, repos, and specs — not just a developer memory tool.

## Files

- `/Users/giladkoch/dev/brain/.worktrees/faithful-memory/docs/prd.md` — Product requirements document for Brain, now version-controlled in git

## Evidence

- May 15: The developer set out to make PRDs version-controlled and repo-native, enabling Brain to detect a... (18 moments)

## Related

- [org registry and drift detection architecture](org-registry-and-drift-detection-architecture.md)
- [product view markdown generator](product-view-markdown-generator.md)
