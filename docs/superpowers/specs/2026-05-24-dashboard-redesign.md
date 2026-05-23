# Dashboard Redesign — Spec

## What

Replace the flat session list with a two-tab dashboard: Brain (shared knowledge) and Sessions (private execution memory). shadcn/ui, minimalist.

## Layout

```
[intent]  [repo selector ▾]     [Brain] [Sessions]
┌──────────────┬─────────────────────────┬───────────────────┐
│  Sidebar     │  Detail                 │  Chat             │
│  240px       │  1fr                    │  360px            │
│  scrollable  │  scrollable             │  fixed input      │
└──────────────┴─────────────────────────┴───────────────────┘
```

No borders between panels — background shade differences only. Muted text for metadata. Monospace for file paths.

## Brain Tab

**Sidebar:** Topic list with counts (insights · sessions · updates). Search + filter by category.

**Detail:** Topic summary, insights grouped by category (structure/decision/constraint/behavior/risk/interface as section headers), files with roles, user's contributing sessions (click → jumps to Sessions tab), related topics.

**Chat:** Scoped to selected topic. System prompt includes topic insights + user's session evidence.

## Sessions Tab

**Sidebar:** Sessions grouped by date. Each shows: truncated narrative, shape badge, moment count, topic badges (click badge → jumps to Brain tab).

**Detail:** Existing session view — narrative, arcs, moments, transitions, outcomes, drill-down to events.

**Chat:** Scoped to selected session. Private.

## API (new endpoints)

```
GET /api/topics?repoId=     → { id, name, summary, insightCount, sessionCount, updateCount }[]
GET /api/topics/:id         → { topic, insights[], files[], sessions[], relatedTopics[] }
```

Existing session endpoints unchanged.

## Tech

- shadcn/ui: Tabs, Card, Badge, Input, ScrollArea, DropdownMenu
- React state for tab/selection/repo — no router
- SSE chat reused from existing implementation
- Express API extended, not replaced

## Cross-tab navigation

- Topic badge on session → Brain tab, selects that topic
- Session in topic detail → Sessions tab, selects that session
