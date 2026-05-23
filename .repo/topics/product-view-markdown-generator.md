# product view markdown generator

Brain's product view is generated as a markdown file (product.md) rather than a web server or React dashboard. The markdown generator is triggered via the CLI and writes output to ~/.brain/product.md. This approach replaced a working React/API web dashboard after the developer questioned whether a web view was needed at the start. The markdown generator worked on first manual test with 209 tests passing.

## constraint

- Do not reintroduce the React/API web dashboard at /product — it was built (207 tests passing) and deliberately replaced by the markdown generator.

## decision

- The product view output layer is a generated markdown file at ~/.brain/product.md, not a web server or React dashboard — the web dashboard was built and working but replaced after the developer questioned its necessity.
- Drift detection is one notification type within a living product view, not the product itself — the product view is the primary surface people look at every day, and drift alerts are surfaced within it.

## behavior

- The markdown generator is invoked via the CLI (src/brain/cli.py) and writes the product view to /Users/giladkoch/.brain/product.md on each run.
- The test suite baseline after the markdown generator implementation is 209 passing tests.

## Files

- `/Users/giladkoch/.brain/product.md` — Generated markdown output file containing the living product view
- `/Users/giladkoch/dev/brain/.worktrees/faithful-memory/docs/plans/2026-05-16-product-view-markdown.md` — Implementation plan for the markdown-based product view generator
- `/Users/giladkoch/dev/brain/.worktrees/faithful-memory/src/brain/cli.py` — CLI entry point that triggers the markdown product view generator

## Evidence

- May 15: The developer set out to make PRDs version-controlled and repo-native, enabling Brain to detect a... (18 moments)

## Related

- [pipeline visibility web view](pipeline-visibility-web-view.md)
- [org registry and drift detection architecture](org-registry-and-drift-detection-architecture.md)
