# Mockups — the app recreation (familiar shell direction)

Working design artifacts for the A-slices (docs/plans/2026-07-22-web-app-recreation.md).
Direction as of 2026-07-22 evening: **familiar app shell** (left-nav hierarchy + list +
detail pane), plain language, perspective pivots. The earlier "Broadsheet & Marginalia"
mocks (01, 02) were rejected by the founder and removed — git history holds them.

| Mock | Surface |
|---|---|
| `04-app-shell.html` | The shell + "Needs you" list + decision detail pane |
| `05-feature-detail.html` | Feature definition page (what this feature IS now) |
| `06-daily-home.html` | Today / what-is-going-on view |
| `07-hierarchy-lenses.html` | Left-nav hierarchy + lens pivots |
| `08-feature-timeline.html` | Feature/org over time (timeline–Gantt perspective) |
| `09-review.html` | A review: diff + inline promise note + verdict/receipt/session rail |

All self-contained HTML with REAL data (verdicts from the analyses store, obligations
from workspaces/, the brain_attention commit 3aa62fc + its real session trailer).
PNGs in `shots/` (Chrome headless, 1600×1000). Mock + render BEFORE any build —
the founder reacts to renders.

Superseded once the surfaces are implemented in `app/`; cull after A6 per
docs-durability (code owns the "how").
