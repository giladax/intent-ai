# Handoff — 2026-05-25 Session 5: Brain MCP, Dedup, Cards UI

## What was done

### Brain MCP server
Stdio MCP server at `src/mcp/server.ts` with 5 graph navigation tools:
- `brain_overview` — top-level area cards (roots only, sorted by insight density)
- `brain_search` — fuzzy search across specs/files/insights with prism filter
- `brain_get` — full spec + child cards; `navigate` section for lightweight tree walking
- `brain_traverse` — co-file discovery (specs sharing source files)
- `brain_file_context` — file→knowledge bridge (constraints/decisions + parent inheritance)

Card is the navigation atom everywhere. Reads `.repo/` filesystem — no DB needed.
Registered in Claude Code project settings (auto-connects next session).

### Insight deduplication (EDD)
String-similarity scoring in `src/pipeline/dedup.ts`:
- Token Dice + containment scoring, threshold 0.7
- Catches rephrased duplicates and subset statements
- Wired into `storeSpecContent()` (insert-time) and `deduplicateInsights()` (post-merge)
- 6/6 eval cases pass (`tests/eval/dedup-criteria.ts`)

### Brain cards in dashboard UI
- API endpoints: `GET /api/brain/cards/:repoId` and `GET /api/brain/cards/:repoId/:nodeName`
- `BrainCardView` component with colored category badges, navigable children, counts footer
- Integrated into TopicDetail — card renders above insight list when available

### Unit tests
8 tests for MCP (formatCard, parseTopic, fuzzyScore) + 6 dedup eval cases. 190 total pass.

## Ideas for next

### 1. Brain-commit coupling ("brain start")
The brain should be coupled to git commits. Each `brain_versions` record should reference the commit SHA at which it was produced. The source of truth is the cloud DB, but `.repo/` is a snapshot pinned to a commit. This enables:
- "What did the brain know at commit X?" queries
- Detecting when `.repo/` is stale vs the DB
- Multi-branch brain divergence (feature branch adds knowledge, main doesn't have it yet)
- The `brain-export` step becomes a "commit the current brain state at HEAD" operation

Implementation direction: `brain_versions.commit_sha` is already nullable in the schema. Wire `brain-export` to set it to HEAD after writing files. MCP server could warn if `.repo/` commit doesn't match HEAD.

### 2. Proactive digestion with user permissions
Currently digestion is manual (`intent digest`). It should happen proactively:
- After a CC session ends, auto-queue it for digestion
- Respect user permissions: "digest my sessions automatically" vs "ask me first"
- Could be a background daemon, a cron, or a hook on CC session close
- Permission model: opt-in per-project, stored in project settings
- Incremental: only digest sessions newer than last digested timestamp

Implementation direction: CC sessions are JSONL files on disk. A watcher (fsnotify or polling) detects new ones, checks project settings for auto-digest permission, and queues them. The dashboard "Sync Brain" flow already handles digest → brain synthesis → export. The proactive version automates the trigger.

## Key commits
```
c2d4245 feat: brain MCP server with graph navigation tools
e877afe feat(mcp): richer card format with category-diverse insights and nav hints
e966d9c feat(mcp): card-driven navigation + unit tests
e8e62c9 feat(web): brain cards display in topic detail
27e9682 feat: string-similarity insight deduplication (EDD)
f88df3c fix(web): digest state persistence + progress on refresh
0941f72 fix(web): Apply reliably finds session IDs + shows errors
6f6a149 feat(web): hierarchical expandable changes review
0483aa9 feat(web): sync diff tree in main panel during review
2c2292a feat: cached proposal — Apply commits exactly what was reviewed
d82a88f feat(web): clickable topics in diff tree → navigate to card detail
bd1f50b feat: organize prompt with standard taxonomy framework
```

### 3. Static analysis: git changes → affected topics
Later phase. When a commit lands, statically analyze which files changed, map those files to brain topics via the file index, and flag affected specs as potentially stale. This closes the loop: code changes automatically surface which knowledge might need updating.

Requires more file-level granularity in the brain — currently files map to specs, but a single file (e.g., `src/adapters/types.ts`) can belong to many specs. The file index needs to track which *parts* of a file (exports, functions, type definitions) are relevant to which spec, not just the file path. This is the bridge to file-level cards and per-symbol tracking.

Implementation direction:
- Parse git diff to get changed files + changed line ranges
- Map changed files to covering topics via `topic_files`
- For each affected topic, compute a staleness signal (how much of its file surface changed)
- Surface in dashboard: "3 specs may be stale after commit abc123"
- Eventually: auto-trigger targeted re-synthesis on affected specs only (not full brain re-run)

### 4. `.repo/` as single source for tree, cards, and agent navigation
The `.repo/` directory should be the canonical source for both the UI and agents. Currently the UI reads from Postgres and `.repo/` is a derived export. Flip this: `.repo/` IS the knowledge tree. The sidebar, overview, and diff tree should all read from the same `.repo/topics/*.md` files that agents read.

Each topic file already has: summary, insights by category, files, sessions, related topics. The card is derivable from this data. The MCP server already reads from `.repo/`.

Next steps:
- UI serves `.repo/` markdown directly (or the server pre-parses it)
- Per-file agent navigation: generate `.repo/files/<path>.md` breadcrumbs that map each source file to its covering specs + card summary + constraints
- Agent's local `.claude/` or project-level file references the `.repo/` structure for navigation
- The sidebar tree component and the overview tree are the same component reading the same data

### 5. Before/after diff with scroll sync
The sync preview should show the current brain tree (left/before) and the proposed tree (right/after) side by side, or as a single annotated tree that you can scroll through. The current implementation shows a single annotated tree. A future iteration could add a "before" snapshot for comparison.

### 6. Sidebar navigation redesign
Current sidebar shows the full knowledge tree + sync button in footer — awkward. Redesign:

**Left sidebar should have two sections:**
- **Sessions** — list of sessions (latest first), undigested count badge, Sync button
  - Clicking Sync opens a full-page process view: live progress at top (aesthetic, satisfying), session list below, knowledge tree with sync that also triggers digest
  - The sync page should feel like watching a build — progress steps, live updates, satisfying completion
- **Knowledge Tree** — file-explorer style, clickable to open card/detail

**The sync flow becomes a first-class page, not a sidebar widget.** It handles the full pipeline: discover → digest → synthesize → review diff → approve → apply. The diff tree (before/after with color annotations) is the centerpiece.

## Design decisions (don't undo)
- MCP reads from `.repo/` filesystem, not DB — works on any branch without infra
- Card is the universal navigation atom (same format in MCP, UI, and export)
- `brain_file_context` surfaces constraints/decisions specifically — editing guidance
- `brain_traverse` defaults to co-file (cross-cutting discovery), not tree walking
- Dedup uses token Dice + containment, not embeddings — fast, deterministic, no external deps
- `navigate` section on brain_get = card + child cards (one call to walk the tree)
