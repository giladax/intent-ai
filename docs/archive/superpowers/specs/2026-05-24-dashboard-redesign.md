# Dashboard Redesign: Split View

**Goal:** Replace the dual-sidebar layout with a single sidebar + center split view (topic detail + chat). Eliminate the right sidebar and the Sessions tab.

## Layout

```
Sidebar (left, collapsible)    │  SidebarInset
                               │  ┌─────────────────────────────────────┐
Project dropdown               │  │ Header: SidebarTrigger │ Breadcrumb │
───────────────                │  ├──────────────────┬──────────────────┤
🔍 Search topics...            │  │ ResizablePanel   │ ResizablePanel   │
                               │  │ (detail, 60%)    │ (chat, 40%)      │
• Topic A                      │  │                  │                  │
• Topic B  ← selected          │  │ Topic detail     │ Chat: Topic B    │
• Topic C                      │  │ (scrollable)     │                  │
                               │  │                  │ [May21✓][May18✓] │
                               │  │ Insights         │ Messages...      │
                               │  │ Files            │                  │
                               │  │ Sessions         │ [Ask about ...]  │
                               │  │ Related          │ [Send]           │
                               │  └──────────────────┴──────────────────┘
```

- Left sidebar: shadcn `Sidebar` with `collapsible="icon"`, project `DropdownMenu`, topic list with search
- Center: `SidebarInset` → header + `ResizablePanelGroup direction="horizontal"`
- Detail panel: `ResizablePanel defaultSize={60} minSize={35}`
- Chat panel: `ResizablePanel defaultSize={40} minSize={20} collapsible collapsedSize={4}`
- Collapsed chat shows expand icon. Header has a "Chat" toggle button (right-aligned) to expand/collapse.

## State

One piece of state: `selectedTopicId: string | null`

- `null` → Overview landing page (full width, no split)
- set → Split view (detail + chat)

No tabs. No active modes.

## Screens

### Overview (no topic selected)

Full-width center panel (no split). Two sections:

**Stats bar**: Topic count, session count, brain version count

**Branch Timeline**: Git-log-style vertical timeline showing commits on the current branch. Brain versions appear as tags (🧠 badges) on the commits they were created for. Each brain-tagged commit shows a one-line diff summary: "+N topics, M insights updated".

```
feat/repo-brain
  │
  ├── 4c57ca9  docs: dashboard redesign spec
  ├── 932eb04  feat(web): shadcn redesign
  ├── 5a1d857  feat(web): rewrite panels          🧠 v3
  │             └ +2 topics, 6 insights updated
  ├── c562d9b  feat(web): dual-sidebar
  ├── 1ef1a19  feat(web): bootstrap tailwind       🧠 v2
  │             └ +3 topics, 9 insights
  └── a03659f  docs: brain pipeline                🧠 v1
                └ initial: 10 topics, 42 insights
```

- Commits from `git log` for the project's source path
- Brain versions matched to commits via `brain_versions.commit_sha`
- Clicking a 🧠 tag filters the topic list sidebar to show topics added/changed in that version
- Non-brain commits shown muted — they're context, not the focus
- Timeline is scrollable, shows last 20 commits by default

**Data source**: New API endpoint `GET /api/timeline?repoId=X` returns commits + brain versions joined on `commit_sha`.

**Zero-data state**: "No execution memory yet. Run `intent digest` then `intent brain`."

### Topic Detail (left panel of split)

Order matters — navigational first, reference second:
1. **Header**: topic name (h2) + summary
2. **Sessions**: list of contributing sessions (date, title, moment count)
3. **Related topics**: badge pills (clickable → switch topic)
4. **Insights**: grouped by category (structure, decision, constraint, behavior, risk, interface) with colored dots + Card per insight
5. **Files**: file paths with role badges

### Chat (right panel of split)

**Header**: "Chat: {topic name}" + clear button (icon)

**Session context chips**: between header and messages
- Render as `<button aria-pressed={on}>` with `Badge` styling
- ON = `variant="default"` (filled), OFF = `variant="outline"` (hollow)
- Default: 3 most recent sessions ON, rest OFF
- Max 5 visible. If more, last chip is "+N more" opening a popover with all sessions as toggles
- Toggling changes what the chat API receives

**Messages area**: scrollable, same bubble styling as current

**Empty state**: "Ask about {topic name}..."

**Input**: `Input` + `Button`, `aria-label="Chat message"`, Enter to send

**Behavior**: messages clear on topic change. Chat API receives topic insights + toggled-on session digests.

## Responsive (<1024px)

Below `lg` breakpoint: no split. Single center panel with two tabs at top: "Detail" | "Chat". Same content, stacked instead of side-by-side.

## Breadcrumb

Header shows: `Overview` (always clickable → deselects topic) or `Overview > Topic Name`

## Components

| Component | Purpose |
|-----------|---------|
| `App.tsx` | Layout: Sidebar + SidebarInset with ResizablePanelGroup |
| `OverviewPanel.tsx` | NEW — landing page when no topic selected |
| `TopicDetail.tsx` | MODIFY — reorder sections (sessions before insights), remove ScrollArea (parent scrolls) |
| `ChatPanel.tsx` | MODIFY — add context chips, remove sidebar wrappers, add clear button, aria-label |
| `TopicList.tsx` | KEEP — already correct |
| `BranchTimeline.tsx` | NEW — git-log timeline with brain version tags |
| `SessionList.tsx` | REMOVE — sessions accessed through topics only |
| `SessionPanel.tsx` | REMOVE — session detail not needed as standalone view |

## Files Touched

- `App.tsx` — new layout, remove right sidebar, add ResizablePanelGroup, breadcrumb, overview/split routing
- `ChatPanel.tsx` — context chips, clear button, plain div wrappers, aria
- `TopicDetail.tsx` — reorder sections
- NEW `OverviewPanel.tsx` — landing page with timeline
- NEW `BranchTimeline.tsx` — git-log timeline component
- Modify: `src/web/server.ts` — add `GET /api/timeline` endpoint
- Modify: `src/pipeline/brain-synthesis.ts` — set `commit_sha` on brain version creation
- DELETE `SessionPanel.tsx`, `SessionList.tsx`

## API

Existing endpoints (unchanged):
- `GET /api/topics?repoId=X` — topic list
- `GET /api/topics/:id` — topic detail with sessions
- `POST /api/chat` — SSE streaming, receives `{ topicId, sessionId, question, history }`

New endpoint:
- `GET /api/timeline?repoId=X` — returns `{ commits: Array<{ sha, message, date }>, brainVersions: Array<{ id, commitSha, createdAt, topicCount, insightCount }> }`. Server runs `git log` on the project's `source_path` and joins with `brain_versions` table on `commit_sha`.

Backend change:
- `intent brain` and `intent digest` must populate `brain_versions.commit_sha` with the current HEAD when creating a version. Currently this field exists but is not set.

## Not in Scope

- Topic hierarchy/grouping
- Session detail standalone view
- Keyboard shortcuts (Cmd+/)
- Fade transitions on scope change
- File path copy-on-click
