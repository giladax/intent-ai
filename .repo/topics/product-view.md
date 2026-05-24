# Product View

> Children: [Implementation Philosophy](implementation-philosophy.md), [Pipeline Visibility UI](pipeline-visibility-ui.md)

The Product View is a markdown-based snapshot of the brain system's state, written to ~/.brain/product.md via a CLI command. It exists to give developers a human-readable, always-available overview of the codebase's current condition without requiring a running server or browser. The implementation was deliberately chosen over a React/API web dashboard after the web server approach proved fragile at startup — the markdown file is simpler, portable, and requires zero infrastructure. The generator is invoked through src/brain/cli.py and produces output in a single pass; on its first manual run it successfully generated the file with all 209 tests passing. Child specs cover the Implementation Philosophy (why file-based over web) and Pipeline Visibility UI (what information is surfaced and how it's structured in the markdown).

## decision

- Product view is a generated markdown file at ~/.brain/product.md, not a web dashboard — this was a deliberate pivot away from a React/API approach after server startup failures made the web approach untenable. Do not reintroduce a web server for this feature.

## behavior

- The markdown generator is triggered via CLI (src/brain/cli.py) and writes its output to ~/.brain/product.md in a single invocation. It is not a background service or daemon — it runs on demand.

## Files

- `/Users/giladkoch/.brain/product.md`
- `docs/plans/2026-05-16-product-view-markdown.md`
- `src/brain/cli.py`
- _from [Implementation Philosophy](implementation-philosophy.md):_
  - `/Users/giladkoch/dev/brain/.worktrees/faithful-memory/docs/plans/2026-05-15-org-registry-drift-detection.md`
- _from [Pipeline Visibility UI](pipeline-visibility-ui.md):_
  - `docs/plans/2026-04-24-pipeline-visibility.md`
  - `docs/superpowers/specs/2026-04-24-pipeline-visibility-design.md`
  - `frontend/src/pages/SessionFeed.tsx`

## Sessions

- May 15: The developer set out to make PRDs version-controlled and repo-native, enabling Brain to detect a... (18 moments)
- May 21: The developer proposed a two-layer model architecture distinguishing observed facts from derived ... (5 moments)
- Apr 23: The developer set out to do a competitive evaluation of Brain against the entireio/cli repo, whic... (24 moments)
