# Pipeline Visibility UI

> Parent: [Product View](product-view.md)

Pipeline Visibility UI is a web view within the Product View that gives developers real-time observability into the session processing pipeline. It solves the problem of sessions existing in two states — tracked (synced into the system) and untracked (raw, not yet processed) — by presenting both in a single chronological feed rather than splitting them across panels. Untracked sessions appear inline with visual distinction; syncing promotes them to full session cards. Each session card carries badge states (tracked/untracked/analyzed) and a per-session analyze button, enabling granular control over which sessions get processed and allowing developers to inspect per-session memory and analysis results. A cursor state display and sync button round out the top-level controls. The authoritative design spec lives at docs/superpowers/specs/2026-04-24-pipeline-visibility-design.md, and the 8-task TDD implementation plan is at docs/plans/2026-04-24-pipeline-visibility.md.

## decision

- Untracked sessions are rendered inline in the chronological feed (Option C), not in a separate panel. This was an explicit design choice to avoid context-switching and keep temporal ordering intact across both session types.
- The analyze action is per-session, not bulk. Each session card has its own analyze button. This is a deliberate requirement, not an oversight — bulk analyze was considered and rejected in favor of per-session memory and analysis inspection.

## Files

- `docs/plans/2026-04-24-pipeline-visibility.md`
- `docs/superpowers/specs/2026-04-24-pipeline-visibility-design.md`
- `frontend/src/pages/SessionFeed.tsx`

## Sessions

- May 15: The developer set out to make PRDs version-controlled and repo-native, enabling Brain to detect a... (18 moments)
- May 21: The developer proposed a two-layer model architecture distinguishing observed facts from derived ... (5 moments)
- Apr 23: The developer set out to do a competitive evaluation of Brain against the entireio/cli repo, whic... (24 moments)
