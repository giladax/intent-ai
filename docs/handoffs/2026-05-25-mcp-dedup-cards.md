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
6dc87eb feat(mcp): card-driven navigation — overview cards, navigate section, co-file traverse, file constraints
e966d9c feat(mcp): card-driven navigation + unit tests
e8e62c9 feat(web): brain cards display in topic detail
27e9682 feat: string-similarity insight deduplication (EDD)
```

## Design decisions (don't undo)
- MCP reads from `.repo/` filesystem, not DB — works on any branch without infra
- Card is the universal navigation atom (same format in MCP, UI, and export)
- `brain_file_context` surfaces constraints/decisions specifically — editing guidance
- `brain_traverse` defaults to co-file (cross-cutting discovery), not tree walking
- Dedup uses token Dice + containment, not embeddings — fast, deterministic, no external deps
- `navigate` section on brain_get = card + child cards (one call to walk the tree)
