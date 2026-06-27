# Dashboard shadcn Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the hand-rolled CSS dashboard with shadcn/ui components for a clean, modern look.

**Architecture:** Install Tailwind + shadcn in the existing Vite/React app. Rewrite each component to use shadcn primitives. Sidebar-driven navigation replaces the header tab bar. Resizable panels replace fixed widths.

**Tech Stack:** React 19, Vite, Tailwind CSS v4, shadcn/ui, Radix primitives

---

### Task 1: Bootstrap Tailwind + shadcn in the UI project

**Files:**
- Modify: `src/web/ui/package.json`
- Modify: `src/web/ui/vite.config.ts`
- Modify: `src/web/ui/tsconfig.json`
- Create: `src/web/ui/src/lib/utils.ts`
- Create: `src/web/ui/components.json`
- Modify: `src/web/ui/src/index.css` (replace with Tailwind directives + theme)

**Step 1: Install dependencies**

```bash
cd src/web/ui
npm install tailwindcss @tailwindcss/vite
npx shadcn@latest init
```

During `shadcn init`, choose:
- Style: New York
- Base color: Stone (warm, matches the off-white aesthetic)
- CSS variables: yes

**Step 2: Verify Tailwind works**

Add a test class to `App.tsx` (e.g. `<div className="text-red-500">test</div>`), run `npm run dev`, confirm it renders red text. Remove the test.

**Step 3: Add shadcn components we'll need**

```bash
cd src/web/ui
npx shadcn@latest add sidebar badge scroll-area separator button input tabs resizable card command tooltip dropdown-menu sheet
```

**Step 4: Configure the theme colors**

Edit `src/web/ui/src/index.css` — set CSS variables for our semantic colors in the shadcn theme layer:

```css
@layer base {
  :root {
    /* keep existing warm palette */
    --shape-narrative: 142 30% 32%;
    --shape-debugging: 30 40% 55%;
    --shape-exploratory: 270 25% 55%;
    --shape-janitorial: 210 15% 55%;
    --shape-review: 210 25% 48%;

    --category-structure: 142 30% 32%;
    --category-decision: 210 25% 48%;
    --category-constraint: 30 40% 55%;
    --category-behavior: 280 20% 52%;
    --category-risk: 0 40% 55%;
    --category-interface: 210 15% 55%;
  }
}
```

**Step 5: Commit**

```bash
git add -A src/web/ui
git commit -m "feat(web): bootstrap tailwind + shadcn in dashboard"
```

---

### Task 2: Layout shell — Sidebar + Resizable panels

**Files:**
- Rewrite: `src/web/ui/src/App.tsx`
- Delete: `src/web/ui/src/components/Header.tsx` (functionality moves into sidebar)
- Modify: `src/web/ui/src/index.css` (remove all old layout CSS)

**Step 1: Rewrite App.tsx with shadcn Sidebar layout**

The new layout structure:

```
┌──────────────────────────────────────────────────┐
│ SidebarProvider                                  │
│ ┌──────────┬─────────────────────────────────────┤
│ │ Sidebar  │  ResizablePanelGroup (horizontal)   │
│ │          │  ┌─────────────────┬────────────────┤│
│ │ - Header │  │ ResizablePanel  │ ResizablePanel ││
│ │   (brand │  │ (detail)        │ (chat)         ││
│ │   +proj) │  │                 │                ││
│ │          │  │                 │                ││
│ │ - Nav    │  │                 │                ││
│ │  Brain   │  │                 │                ││
│ │  Sessions│  │                 │                ││
│ │          │  │                 │                ││
│ │ - List   │  │                 │                ││
│ │  (topics │  │                 │                ││
│ │  or sess)│  │                 │                ││
│ └──────────┴──┴─────────────────┴────────────────┘
```

```tsx
// App.tsx — new structure
import { SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarGroup,
         SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton,
         SidebarTrigger } from "./components/ui/sidebar"
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "./components/ui/resizable"

export function App() {
  // ... keep all existing state hooks unchanged ...

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          {/* Brand + project dropdown */}
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            {/* Brain / Sessions nav buttons */}
          </SidebarGroup>
          <SidebarGroup>
            {/* Topic list OR Session list based on activeTab */}
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      <main className="flex-1 flex flex-col">
        <div className="flex items-center gap-2 px-4 py-2 border-b">
          <SidebarTrigger />
          {/* breadcrumb or title */}
        </div>
        <ResizablePanelGroup direction="horizontal" className="flex-1">
          <ResizablePanel defaultSize={65} minSize={40}>
            {/* Detail panel (TopicDetail or SessionPanel) */}
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={35} minSize={20} collapsible collapsedSize={0}>
            {/* ChatPanel */}
          </ResizablePanel>
        </ResizablePanelGroup>
      </main>
    </SidebarProvider>
  )
}
```

**Step 2: Move project selector into sidebar header**

Replace the Header component's project `<select>` with a shadcn `DropdownMenu` inside `SidebarHeader`. Include the "+" create project flow using a `Sheet` or inline form.

**Step 3: Move tab switching into sidebar nav**

Two `SidebarMenuButton` items with icons (Brain, List) that control `activeTab`. The active one gets a highlighted style.

**Step 4: Move topic/session list into sidebar content**

The existing `TopicList` and `SessionList` render inside `SidebarContent`, but now using `SidebarMenu`/`SidebarMenuItem` for each item instead of raw buttons.

**Step 5: Remove all old layout CSS from index.css**

Delete everything from `.app` through `.header-*`, `.sidebar`, `.sidebar-*` classes. The `.detail` and `.chat` grid rules go too — replaced by Resizable panels.

**Step 6: Verify it renders**

Run `npm run dev` in `src/web/ui`, open browser, confirm sidebar collapses, panels resize, Brain/Sessions toggle works.

**Step 7: Commit**

```bash
git add -A src/web/ui
git commit -m "feat(web): replace layout with shadcn sidebar + resizable panels"
```

---

### Task 3: Sidebar content — TopicList + SessionList

**Files:**
- Rewrite: `src/web/ui/src/components/TopicList.tsx`
- Rewrite: `src/web/ui/src/components/SessionList.tsx`

**Step 1: Rewrite TopicList**

Use `SidebarMenu` + `SidebarMenuItem` + `SidebarMenuButton`. Each topic item shows:
- Name (font-medium)
- Below: insight count + session count as muted text
- Selected state via `isActive` prop on `SidebarMenuButton`

Add a search input at the top using shadcn `Input` with a search icon. Filter topics by name client-side.

```tsx
<SidebarGroup>
  <SidebarGroupLabel>Topics</SidebarGroupLabel>
  <div className="px-2 pb-2">
    <Input placeholder="Search topics..." value={search} onChange={...} className="h-7 text-xs" />
  </div>
  <SidebarMenu>
    {filtered.map(t => (
      <SidebarMenuItem key={t.id}>
        <SidebarMenuButton isActive={selectedTopicId === t.id} onClick={() => onSelectTopic(t.id)}>
          <div>
            <div className="font-medium text-sm">{t.name}</div>
            <div className="text-xs text-muted-foreground">{t.insight_count} insights · {t.session_count} sessions</div>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    ))}
  </SidebarMenu>
</SidebarGroup>
```

**Step 2: Rewrite SessionList**

Keep date grouping. Each session item:
- Title (truncated narrative)
- Shape badge using shadcn `Badge` with variant color
- Moment count
- Topic badges (clickable, using `Badge` variant="outline")

Use `SidebarGroupLabel` for date groups.

Shape badge colors via Tailwind classes:
- `bg-[hsl(var(--shape-narrative))]` for narrative
- etc.

**Step 3: Remove old sidebar CSS**

Delete `.sidebar-header`, `.sidebar-title`, `.sidebar-count`, `.sidebar-list`, `.sidebar-date-group`, `.sidebar-item`, `.sidebar-item-name`, `.sidebar-item-meta`, `.sidebar-item-topics`, `.shape-label`, `.shape-*`, `.topic-badge` from `index.css`.

**Step 4: Commit**

```bash
git add src/web/ui/src/components/TopicList.tsx src/web/ui/src/components/SessionList.tsx src/web/ui/src/index.css
git commit -m "feat(web): rewrite sidebar lists with shadcn menu components"
```

---

### Task 4: Detail panels — TopicDetail + SessionPanel

**Files:**
- Rewrite: `src/web/ui/src/components/TopicDetail.tsx`
- Rewrite: `src/web/ui/src/components/SessionPanel.tsx`

**Step 1: Rewrite TopicDetail**

Use `ScrollArea` as wrapper. Structure with Tailwind spacing:

```tsx
<ScrollArea className="h-full">
  <div className="max-w-2xl p-6 space-y-6">
    <div>
      <h2 className="text-xl font-semibold tracking-tight">{topic.name}</h2>
      <p className="text-sm text-muted-foreground leading-relaxed mt-1">{topic.summary}</p>
    </div>

    {/* Insights grouped by category */}
    {CATEGORY_ORDER.filter(c => byCategory.has(c)).map(cat => (
      <div key={cat} className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: `hsl(var(--category-${cat}))` }} />
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{cat}</span>
        </div>
        {byCategory.get(cat)!.map((insight, i) => (
          <Card key={i} className="p-3">
            <p className="text-sm leading-relaxed">{insight.statement}</p>
          </Card>
        ))}
      </div>
    ))}

    {/* Files */}
    {files.length > 0 && (
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Files</h3>
        {files.map((f, i) => (
          <div key={i} className="flex items-baseline gap-2">
            <code className="text-xs">{f.file_path}</code>
            {f.role && <Badge variant="secondary" className="text-[10px]">{f.role}</Badge>}
          </div>
        ))}
      </div>
    )}

    {/* Sessions */}
    {/* Related topics */}
  </div>
</ScrollArea>
```

Sessions section: use `Button variant="ghost"` for each session row.
Related topics: use `Badge variant="outline"` as clickable pills.

**Step 2: Rewrite SessionPanel**

Same pattern — `ScrollArea` wrapper, `Card` for sections.

- Shape badge: `Badge` with shape color background
- Stats: muted text next to badge
- Arcs: each arc in a row with title + resolution `Badge`
- Moments: `Card` per moment with type badge + agency tag + statement
- Outcomes: `Card` with left border accent
- Abandoned: `Card` with amber left border, muted text

```tsx
{/* Moment item */}
<Card className="p-3 space-y-1">
  <div className="flex items-center gap-2">
    <Badge variant="secondary" className="text-[10px] uppercase">{m.type}</Badge>
    <span className="text-[10px] text-muted-foreground">{m.agency}</span>
  </div>
  <p className="text-sm leading-relaxed">{m.statement}</p>
</Card>
```

**Step 3: Remove old detail CSS**

Delete `.detail`, `.detail-empty`, `.topic-detail`, `.topic-name`, `.topic-summary`, `.topic-insights`, `.insight-*`, `.topic-section*`, `.topic-file`, `.file-role`, `.topic-session*`, `.topic-related`, `.related-topic-btn`, `.session-detail*`, `.shape-badge-lg`, `.arc-*`, `.moment-*`, `.outcome-*`, `.abandoned-*` from `index.css`.

**Step 4: Commit**

```bash
git add src/web/ui/src/components/TopicDetail.tsx src/web/ui/src/components/SessionPanel.tsx src/web/ui/src/index.css
git commit -m "feat(web): rewrite detail panels with shadcn cards + badges"
```

---

### Task 5: Chat panel

**Files:**
- Rewrite: `src/web/ui/src/components/ChatPanel.tsx`

**Step 1: Rewrite ChatPanel**

Use `ScrollArea` for messages, shadcn `Input` + `Button` for the input row. Messages styled with Tailwind:

```tsx
<div className="flex flex-col h-full">
  {/* Header */}
  <div className="px-4 py-2 border-b">
    <span className="text-xs font-medium text-muted-foreground">{label()}</span>
  </div>

  {/* Messages */}
  <ScrollArea className="flex-1 p-3">
    <div className="space-y-2">
      {messages.map((m, i) => (
        <div key={i} className={cn(
          "max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap",
          m.role === "user"
            ? "ml-auto bg-primary text-primary-foreground rounded-br-sm"
            : "bg-muted rounded-bl-sm"
        )}>
          {m.content || (streaming && i === messages.length - 1 ? "..." : "")}
        </div>
      ))}
      <div ref={messagesEndRef} />
    </div>
  </ScrollArea>

  {/* Input */}
  <div className="flex gap-2 p-3 border-t">
    <Input ref={inputRef} value={input} onChange={...} onKeyDown={...}
           placeholder="Ask..." disabled={streaming} className="text-sm" />
    <Button size="sm" onClick={handleSend} disabled={streaming || !input.trim()}>Send</Button>
  </div>
</div>
```

**Step 2: Remove old chat CSS**

Delete `.chat`, `.chat-header`, `.chat-scope`, `.chat-messages`, `.chat-empty`, `.chat-msg*`, `.chat-input*`, `.chat-send` from `index.css`.

**Step 3: Commit**

```bash
git add src/web/ui/src/components/ChatPanel.tsx src/web/ui/src/index.css
git commit -m "feat(web): rewrite chat panel with shadcn components"
```

---

### Task 6: Clean up — delete old CSS, verify, build

**Files:**
- Modify: `src/web/ui/src/index.css` (should be ~20 lines of Tailwind directives + theme vars now)
- Delete: `src/web/ui/src/components/Header.tsx` (if not already deleted in Task 2)
- Modify: `src/web/ui/src/main.tsx` (verify imports)

**Step 1: Verify index.css is clean**

The file should contain only:
- `@tailwind base/components/utilities` directives
- `@layer base` with CSS variable definitions for shadcn theme + our semantic colors
- Custom scrollbar styles (optional, minimal)
- Nothing else

**Step 2: Run build**

```bash
cd src/web/ui && npm run build
```

Fix any TypeScript or build errors.

**Step 3: Test with the actual server**

```bash
npx tsx src/cli/index.ts web --port 3456
```

Open `localhost:3456`, verify:
- Sidebar shows Brain/Sessions navigation
- Sidebar collapses to icons
- Project dropdown works
- Topic list filters by search
- Session list groups by date with shape badges
- Topic detail shows insights by category in cards
- Session detail shows narrative, moments, outcomes
- Chat panel resizes, streaming works
- Cross-tab navigation (topic badge → brain, session link → sessions)

**Step 4: Commit**

```bash
git add -A src/web/ui
git commit -m "feat(web): complete shadcn dashboard redesign"
```

---

### Task 7: Polish pass

**Files:** All component files in `src/web/ui/src/components/`

**Step 1: Empty states**

Add warm empty states:
- No topics: centered text with `intent brain` hint
- No sessions: centered text with `intent digest` hint
- No selection: subtle prompt in detail area

**Step 2: Loading states**

Add skeleton loading (shadcn `Skeleton` component) for:
- Topic detail fetch
- Session detail fetch

**Step 3: Transitions**

Add subtle transitions:
- Sidebar collapse/expand (handled by shadcn)
- Panel resize (handled by shadcn)
- Selection highlight (add `transition-colors` to list items)

**Step 4: Commit**

```bash
git add -A src/web/ui
git commit -m "feat(web): add empty states, loading skeletons, transitions"
```
