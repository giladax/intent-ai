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

Full-width center panel (no split). Shows:
- Topic count, session count
- 5 most recently updated topics (clickable)
- 5 most recent sessions (date + title, clickable → selects parent topic)

Zero-data state: "No execution memory yet. Run `intent digest` then `intent brain`."

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
| `SessionList.tsx` | REMOVE — sessions accessed through topics only |
| `SessionPanel.tsx` | REMOVE — session detail not needed as standalone view |

## Files Touched

- `App.tsx` — new layout, remove right sidebar, add ResizablePanelGroup, breadcrumb, overview/split routing
- `ChatPanel.tsx` — context chips, clear button, plain div wrappers, aria
- `TopicDetail.tsx` — reorder sections
- NEW `OverviewPanel.tsx` — landing page
- DELETE `SessionPanel.tsx`, `SessionList.tsx`

## API

No API changes. Existing endpoints:
- `GET /api/topics?repoId=X` — topic list
- `GET /api/topics/:id` — topic detail with sessions
- `POST /api/chat` — SSE streaming, receives `{ topicId, sessionId, question, history }`

Chat API already supports topic-scoped context. Session chips control which session IDs are sent.

## Not in Scope

- Topic hierarchy/grouping
- Session detail standalone view
- Keyboard shortcuts (Cmd+/)
- Fade transitions on scope change
- File path copy-on-click
