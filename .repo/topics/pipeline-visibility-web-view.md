# pipeline visibility web view

A planned web view that exposes the ingestion pipeline state to the developer: cursor position, sync button, per-session analyze button, and tracked/untracked/analyzed badges. Untracked sessions appear inline in the unified chronological feed (not a separate panel), visually distinct from tracked sessions. Sync 'promotes' untracked entries to real cards. The design spec and 8-task TDD implementation plan are both committed to version control.

## structure

- The implementation is planned as 8 TDD tasks documented in docs/plans/2026-04-24-pipeline-visibility.md, with a design spec at docs/superpowers/specs/2026-04-24-pipeline-visibility-design.md — both committed to git.

## decision

- Untracked sessions appear inline in the unified chronological feed mixed with tracked sessions (option C), not in a separate panel — sync promotes them to real cards.
- The analyze action is session-scoped (one button per session card), not bulk — preserving developer control over token spend and matching the session-first philosophy.

## behavior

- The implementation plan was grounded in actual source files (api.py, db.py, fact_extractor.py, config.py) before being written — planning from spec alone was rejected in favor of reading the real codebase.

## interface

- The web view must expose: cursor position, sync button, analyze button (per session), and tracked/untracked/analyzed badges on session cards.

## Files

- `docs/plans/2026-04-24-pipeline-visibility.md` — 8-task TDD implementation plan for the pipeline visibility feature
- `docs/superpowers/specs/2026-04-24-pipeline-visibility-design.md` — Design spec for the pipeline visibility web view, code-reviewed and committed
- `frontend/src/pages/SessionFeed.tsx` — Frontend feed page that will render inline untracked sessions and status badges
- `src/brain/api.py` — Backend API that will need new endpoints for sync, analyze, and cursor state

## Evidence

- Apr 23: The developer set out to do a competitive evaluation of Brain against the entireio/cli repo, whic... (24 moments)

## Related

- [digestion pipeline](digestion-pipeline.md)
- [intent pipeline v2 architecture](intent-pipeline-v2-architecture.md)
- [claude_collector cursor mechanism](claude-collector-cursor-mechanism.md)
