# Dashboard & CLI

The Dashboard & CLI layer provides the primary human-facing interfaces for interacting with the system — a web-based dashboard for visual monitoring and control, and a command-line interface for scripted, automated, or developer-oriented operations. These two surfaces share underlying data and service contracts but serve distinct interaction patterns: the dashboard prioritizes at-a-glance status, historical trends, and interactive configuration, while the CLI prioritizes composability, scriptability, and low-friction access from terminal environments. Together they form the operator control plane, sitting above the core processing pipeline and exposing its state and controls without duplicating pipeline logic. Pipeline Visibility UI is handled in a dedicated child spec and covers the specific components that render pipeline state within the dashboard.

## constraint

- The implementation order is strictly: (1) product view, (2) drift/alerting on top of the view. Reversing this order is an explicit anti-pattern that was identified and corrected.
- Pipeline Visibility UI is explicitly scoped to a child spec — the Dashboard & CLI spec must not re-document pipeline rendering components; it should reference that child spec instead.

## decision

- The analyze action is per-session, not bulk. Each session card has its own analyze button. This is a deliberate requirement, not an oversight — bulk analyze was considered and rejected in favor of per-session memory and analysis inspection.
- Untracked sessions are rendered inline in the chronological feed (Option C), not in a separate panel. This was an explicit design choice to avoid context-switching and keep temporal ordering intact across both session types.
- Product view is a generated markdown file at ~/.brain/product.md, not a web dashboard — this was a deliberate pivot away from a React/API approach after server startup failures made the web approach untenable. Do not reintroduce a web server for this feature.
- EDD-first means gold test cases are written before feature implementation, importing or mocking pre-existing work to validate against real data — no feature is built without a passing test that proves the prior layer works.
- A dedicated CLI exists alongside the dashboard to support automation, CI/CD integration, and developer workflows where a browser-based UI would be impractical — this is an intentional dual-surface design, not redundancy.

## behavior

- The markdown generator is triggered via CLI (src/brain/cli.py) and writes its output to ~/.brain/product.md in a single invocation. It is not a background service or daemon — it runs on demand.
- The dashboard is expected to provide real-time or near-real-time status updates, implying either polling or a push mechanism (websockets/SSE) from the backend — the CLI by contrast operates in request-response mode.

## risk

- With two separate interface surfaces, there is a risk of feature drift where capabilities are added to one interface but not the other — a shared service/API layer is the mitigation, but discipline is required to keep both surfaces in sync.

## Files

- `/Users/giladkoch/.brain/product.md`
- `/Users/giladkoch/dev/brain/.worktrees/faithful-memory/docs/plans/2026-05-15-org-registry-drift-detection.md`
- `docs/plans/2026-04-24-pipeline-visibility.md`
- `docs/plans/2026-05-16-product-view-markdown.md`
- `docs/superpowers/specs/2026-04-24-pipeline-visibility-design.md`
- `frontend/src/pages/SessionFeed.tsx`
- `src/brain/cli.py`

## Sessions

- May 15: The developer set out to make PRDs version-controlled and repo-native, enabling Brain to detect a... (18 moments)
- May 21: The developer proposed a two-layer model architecture distinguishing observed facts from derived ... (5 moments)
- Apr 5: The developer assigned the AI to implement Task 10 of the Faithful Memory Foundation plan — loop ... (10 moments)
- Apr 23: The developer set out to do a competitive evaluation of Brain against the entireio/cli repo, whic... (24 moments)
