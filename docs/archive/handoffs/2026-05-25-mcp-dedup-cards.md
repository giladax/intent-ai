# Handoff — 2026-05-25 Session 5: Brain MCP, Dedup, Cards UI, Dashboard Redesign

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

### Organize prompt taxonomy
Updated `src/llm/prompts/brain-organize.ts` with standard software-project categories:
- Architecture & Infrastructure, Core Pipeline, Features, APIs & Interfaces, Dashboard/UI, Testing & Quality
- LLM adapts names but won't create micro-roots like "Data Collection" or "Rejected Integrations"
- 3-6 root target, roots with <2 insights get merged

### Cached proposal (Apply = what you reviewed)
- Propose caches `plan + specs` in server job — no re-synthesis on Apply
- Apply reads cached result, commits to DB + exports markdown
- TTL 30 min for slow synthesis
- Session IDs embedded in proposal for reliable Apply

### Dashboard redesign
**Navigation:**
- Sidebar: Overview | Knowledge Tree (count) | Sessions (count + undigested badge) | Sync Brain button
- All badges positioned top-right corner
- Chat panel available on every page via header toggle (open by default)

**Knowledge Tree page:**
- shadcn Collapsible + Tooltip components
- Folder/file icons, border-left tree lines
- Card container, click navigates to topic detail

**Sessions page:**
- Per-project sessions (filtered by source_path, not global)
- Clickable → session detail with narrative + moments timeline
- Moments: type-colored dots, statement, significance, agency, confidence
- Undigested banner with digest button

**Sync Brain page (full-page flow):**
- Splash: brain icon + "Start Sync" button (auto-starts)
- Progress: pulsing brain + spinner during digesting
- Diff tree: annotated knowledge graph (green=new, blue=update, orange=merge, strikethrough=merged-away)
- Semantic summary at top of diff
- Celebration: confetti burst + party popper on completion
- Sidebar button: shimmer animation when active, centered text, floating badge

**Branch timeline:**
- Fetches 50 commits (was 20) to capture older brain versions
- Shows last 15 + any older commits with brain version badges

### Bug fixes
- Log discovery excludes subagent transcripts (scoped search, no recursion into subdirectories)
- Digest state persisted via upsertJob (survives page refresh)
- Apply button reliably finds session IDs (state → proposal → server job fallback)
- Breadcrumb truncation (300px max), session titles use date not full narrative
- Removed hover cards (caused z-index clipping behind chat panel)

## Ideas for next

### 1. Brain-commit coupling ("brain start")
Pin brain versions to git commits. `brain_versions.commit_sha` already exists. Wire `brain-export` to set it to HEAD.

### 2. Proactive digestion with user permissions
Auto-digest after CC session close. Permission model per-project. Watcher or hook trigger.

### 3. Static analysis: git changes → affected topics
Parse git diff → map to covering topics → staleness signal. Needs per-symbol file granularity.

### 4. `.repo/` as single source for tree, cards, and agent navigation
UI and agents both read from `.repo/`. Per-file breadcrumbs: `.repo/files/<path>.md` mapping each source file to covering specs + card + constraints.

### 5. Before/after diff with scroll sync
Show current vs proposed tree side by side, or annotated single tree with scroll.

### 6. Sidebar navigation redesign (further iteration)
Sync flow as first-class page with live progress. Sessions list with per-session digestion status.

### 7. Card quality
Summaries are truncated spec text — should be LLM-generated arc-style narratives. Haiku call per card during brain-export.

### 8. SSE live push
Frontend doesn't update in real-time during digest — only on refresh. SSE reconnection or polling needed.

## Key commits
```
c2d4245 feat: brain MCP server with graph navigation tools
e966d9c feat(mcp): card-driven navigation + unit tests
e8e62c9 feat(web): brain cards display in topic detail
27e9682 feat: string-similarity insight deduplication (EDD)
f88df3c fix(web): digest state persistence + progress on refresh
2c2292a feat: cached proposal — Apply commits exactly what was reviewed
0483aa9 feat(web): sync diff tree in main panel during review
bd1f50b feat: organize prompt with standard taxonomy framework
64b6e95 fix: log discovery excludes subagent transcripts
8d0024e feat(web): clean nav — two sidebar items + chat on every page
0a3bd02 feat(web): per-project sessions + clickable session detail
328011d feat(web): knowledge tree using shadcn Collapsible + Tooltip
de1c209 feat(web): sync animations — splash, progress, confetti celebration
```

## Design decisions (don't undo)
- MCP reads from `.repo/` filesystem, not DB — works on any branch without infra
- Card is the universal navigation atom (same format in MCP, UI, and export)
- `brain_file_context` surfaces constraints/decisions specifically — editing guidance
- `brain_traverse` defaults to co-file (cross-cutting discovery), not tree walking
- Dedup uses token Dice + containment, not embeddings — fast, deterministic, no external deps
- `navigate` section on brain_get = card + child cards (one call to walk the tree)
- Cached proposal: what you review is exactly what gets applied (no re-synthesis)
- Sessions scoped by project source_path, not global
- Log discovery: scoped search doesn't recurse into subdirectories (excludes subagent logs)
- No hover cards — click navigates to detail instead (hover caused z-index issues)
- Organize prompt uses standard taxonomy framework with flexibility to adapt
