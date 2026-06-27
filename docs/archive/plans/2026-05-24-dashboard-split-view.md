# Dashboard Split View Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace dual-sidebar layout with single sidebar + center split view (topic detail + chat in ResizablePanelGroup).

**Architecture:** Remove right Sidebar and Sessions tab. Center uses ResizablePanelGroup with two panels: topic detail (60%) and chat (40%). When no topic is selected, show a full-width overview landing page. Chat gets session context chips for toggling which sessions feed the API.

**Tech Stack:** React 19, Vite, shadcn/ui (ResizablePanel, Badge, Breadcrumb, Popover, Tabs), Tailwind CSS v4

---

### Task 1: Simplify App.tsx — Remove right sidebar, sessions tab, add ResizablePanelGroup

**Files:**
- Modify: `src/web/ui/src/App.tsx`

**Step 1: Rewrite App.tsx**

Remove all sessions state, SessionList, SessionPanel, right Sidebar, Brain/Sessions tab toggle. Add ResizablePanelGroup in SidebarInset. Add breadcrumb.

```tsx
import { useState, useEffect, useCallback } from "react";
import { TopicList } from "./components/TopicList";
import { TopicDetail } from "./components/TopicDetail";
import { ChatPanel } from "./components/ChatPanel";
import { OverviewPanel } from "./components/OverviewPanel";
import { fetchProjects, fetchTopics, fetchSessions } from "./api";
import type { Project, TopicSummary, Session } from "./types";
import { Brain as BrainIcon, ChevronDown, MessageSquare, X } from "lucide-react";
import {
  SidebarProvider, Sidebar, SidebarHeader, SidebarContent,
  SidebarMenu, SidebarMenuItem, SidebarMenuButton,
  SidebarTrigger, SidebarInset,
} from "@/components/ui/sidebar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList,
  BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  ResizablePanelGroup, ResizablePanel, ResizableHandle,
} from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [topics, setTopics] = useState<TopicSummary[]>([]);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [chatCollapsed, setChatCollapsed] = useState(false);

  useEffect(() => {
    fetchProjects().then((ps) => {
      setProjects(ps);
      if (ps.length > 0) setSelectedProject(ps[0]);
    });
    fetchSessions().then(setSessions);
  }, []);

  useEffect(() => {
    if (!selectedProject) { setTopics([]); return; }
    fetchTopics(selectedProject.id).then(setTopics).catch(() => setTopics([]));
  }, [selectedProject]);

  const handleProjectChange = (p: Project) => {
    setSelectedProject(p);
    setSelectedTopicId(null);
  };

  const handleTopicSelect = (id: string) => setSelectedTopicId(id);

  const navigateToTopic = useCallback((topicId: string) => {
    setSelectedTopicId(topicId);
  }, []);

  const selectedTopicName = topics.find((t) => t.id === selectedTopicId)?.name;

  return (
    <SidebarProvider>
      <Sidebar side="left" collapsible="icon" className="border-r-0">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton className="font-semibold">
                    <BrainIcon className="size-4" />
                    <span>{selectedProject?.name ?? "intent"}</span>
                    <ChevronDown className="ml-auto size-4" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  {projects.map((p) => (
                    <DropdownMenuItem key={p.id} onClick={() => handleProjectChange(p)}>
                      {p.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <TopicList topics={topics} selectedTopicId={selectedTopicId} onSelectTopic={handleTopicSelect} />
        </SidebarContent>
      </Sidebar>

      <SidebarInset>
        <header className="sticky top-0 flex h-14 shrink-0 items-center gap-2 border-b bg-background z-10">
          <div className="flex flex-1 items-center gap-2 px-3">
            <SidebarTrigger />
            <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  {selectedTopicId ? (
                    <BreadcrumbLink href="#" onClick={(e) => { e.preventDefault(); setSelectedTopicId(null); }}>
                      Overview
                    </BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage>Overview</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
                {selectedTopicId && selectedTopicName && (
                  <>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      <BreadcrumbPage>{selectedTopicName}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </>
                )}
              </BreadcrumbList>
            </Breadcrumb>
          </div>
          {selectedTopicId && (
            <Button
              variant="ghost" size="sm"
              className="mr-3"
              onClick={() => setChatCollapsed(!chatCollapsed)}
            >
              {chatCollapsed ? <MessageSquare className="size-4" /> : <X className="size-4" />}
              <span className="ml-1 text-xs">{chatCollapsed ? "Chat" : "Close"}</span>
            </Button>
          )}
        </header>

        <div className="flex-1 overflow-hidden">
          {!selectedTopicId ? (
            <OverviewPanel
              topics={topics}
              sessions={sessions}
              onTopicClick={handleTopicSelect}
            />
          ) : (
            <ResizablePanelGroup direction="horizontal">
              <ResizablePanel defaultSize={60} minSize={35}>
                <div className="h-full overflow-y-auto">
                  <TopicDetail
                    topicId={selectedTopicId}
                    onSessionClick={() => {}}
                    onTopicClick={navigateToTopic}
                  />
                </div>
              </ResizablePanel>
              {!chatCollapsed && (
                <>
                  <ResizableHandle withHandle />
                  <ResizablePanel defaultSize={40} minSize={20}>
                    <ChatPanel
                      topicId={selectedTopicId}
                      topicName={selectedTopicName ?? ""}
                    />
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
```

**Step 2: Verify build**

```bash
cd src/web/ui && npm run build
```

Expected: build may fail because `OverviewPanel` doesn't exist yet and `ChatPanel` props changed. That's fine — we fix those in the next tasks.

**Step 3: Commit**

```bash
git add src/web/ui/src/App.tsx
git commit -m "feat(web): restructure layout — single sidebar + resizable split view"
```

---

### Task 2: Create OverviewPanel

**Files:**
- Create: `src/web/ui/src/components/OverviewPanel.tsx`

**Step 1: Implement OverviewPanel**

```tsx
import type { TopicSummary, Session } from "../types";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Props {
  topics: TopicSummary[];
  sessions: Session[];
  onTopicClick: (id: string) => void;
}

export function OverviewPanel({ topics, sessions, onTopicClick }: Props) {
  if (topics.length === 0 && sessions.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        <div className="text-center space-y-2">
          <p>No execution memory yet.</p>
          <p>Run <code className="bg-muted px-1.5 py-0.5 rounded text-xs">intent digest</code> then <code className="bg-muted px-1.5 py-0.5 rounded text-xs">intent brain</code></p>
        </div>
      </div>
    );
  }

  const recentTopics = [...topics]
    .sort((a, b) => b.update_count - a.update_count)
    .slice(0, 5);

  const recentSessions = [...sessions]
    .sort((a, b) => {
      const da = a.started_at ? new Date(a.started_at).getTime() : 0;
      const db = b.started_at ? new Date(b.started_at).getTime() : 0;
      return db - da;
    })
    .slice(0, 5);

  const formatDate = (d: string | null) => {
    if (!d) return "";
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 space-y-8">
        {/* Stats */}
        <div className="flex gap-4">
          <Card className="flex-1 p-4 text-center">
            <div className="text-2xl font-semibold">{topics.length}</div>
            <div className="text-xs text-muted-foreground">Topics</div>
          </Card>
          <Card className="flex-1 p-4 text-center">
            <div className="text-2xl font-semibold">{sessions.length}</div>
            <div className="text-xs text-muted-foreground">Sessions</div>
          </Card>
        </div>

        {/* Recent topics */}
        {recentTopics.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent Topics</h3>
            {recentTopics.map((t) => (
              <Card
                key={t.id}
                className="p-3 cursor-pointer hover:bg-accent/50 transition-colors"
                onClick={() => onTopicClick(t.id)}
              >
                <div className="font-medium text-sm">{t.name}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {t.insight_count} insights · {t.session_count} sessions
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Recent sessions */}
        {recentSessions.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent Sessions</h3>
            {recentSessions.map((s) => (
              <Card key={s.id} className="p-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground shrink-0">{formatDate(s.started_at)}</span>
                  <span className="text-sm truncate">{s.narrative_summary?.split(/[.!?\n]/)[0] || "No narrative"}</span>
                  {s.session_shape && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">{s.session_shape}</Badge>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Verify build**

```bash
cd src/web/ui && npm run build
```

Expected: may still fail if ChatPanel props haven't been updated yet.

**Step 3: Commit**

```bash
git add src/web/ui/src/components/OverviewPanel.tsx
git commit -m "feat(web): add overview landing page"
```

---

### Task 3: Rewrite ChatPanel — context chips, plain layout, new props

**Files:**
- Modify: `src/web/ui/src/components/ChatPanel.tsx`

**Step 1: Rewrite ChatPanel**

New props: `topicId` + `topicName` (no more `sessionId`, `scopeLabel`). Add session context chips. Use plain divs (no sidebar wrappers).

```tsx
import { useState, useRef, useEffect } from "react";
import { streamChat } from "../api";
import { fetchTopicDetail } from "../api";
import type { ChatMessage, TopicSession } from "../types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Trash2 } from "lucide-react";

interface Props {
  topicId: string;
  topicName: string;
}

const MAX_VISIBLE_CHIPS = 5;

export function ChatPanel({ topicId, topicName }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [sessions, setSessions] = useState<TopicSession[]>([]);
  const [enabledSessionIds, setEnabledSessionIds] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load sessions when topic changes
  useEffect(() => {
    setMessages([]);
    setSessions([]);
    setEnabledSessionIds(new Set());
    fetchTopicDetail(topicId).then((detail) => {
      const sorted = [...detail.sessions].sort((a, b) => {
        const da = a.started_at ? new Date(a.started_at).getTime() : 0;
        const db = b.started_at ? new Date(b.started_at).getTime() : 0;
        return db - da;
      });
      setSessions(sorted);
      // Default: 3 most recent ON
      setEnabledSessionIds(new Set(sorted.slice(0, 3).map((s) => s.session_id)));
    });
  }, [topicId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const toggleSession = (id: string) => {
    setEnabledSessionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const formatDate = (d: string | null) => {
    if (!d) return "?";
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const handleSend = async () => {
    const q = input.trim();
    if (!q || streaming) return;

    const userMsg: ChatMessage = { role: "user", content: q };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setStreaming(true);

    const assistantMsg: ChatMessage = { role: "assistant", content: "" };
    setMessages((prev) => [...prev, assistantMsg]);

    try {
      const history = messages.slice(-20);
      // Send first enabled session ID for context (API currently takes one sessionId)
      const firstEnabledSession = sessions.find((s) => enabledSessionIds.has(s.session_id));
      for await (const event of streamChat(
        q, history, undefined,
        firstEnabledSession?.session_id,
        topicId,
      )) {
        if (event.type === "text" && event.content) {
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last.role === "assistant") {
              updated[updated.length - 1] = { ...last, content: last.content + event.content };
            }
            return updated;
          });
        } else if (event.type === "error") {
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last.role === "assistant") {
              updated[updated.length - 1] = { ...last, content: `Error: ${event.content}` };
            }
            return updated;
          });
        }
      }
    } catch (err) {
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last.role === "assistant") {
          updated[updated.length - 1] = { ...last, content: `Error: ${err instanceof Error ? err.message : String(err)}` };
        }
        return updated;
      });
    } finally {
      setStreaming(false);
      inputRef.current?.focus();
    }
  };

  const visibleChips = sessions.slice(0, MAX_VISIBLE_CHIPS);
  const overflowChips = sessions.slice(MAX_VISIBLE_CHIPS);

  return (
    <div className="flex flex-col h-full border-l">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b">
        <span className="text-sm font-medium">Chat: {topicName}</span>
        {messages.length > 0 && (
          <Button variant="ghost" size="icon" className="size-6" onClick={() => setMessages([])}>
            <Trash2 className="size-3" />
          </Button>
        )}
      </div>

      {/* Session context chips */}
      {sessions.length > 0 && (
        <div className="shrink-0 flex flex-wrap gap-1.5 px-3 py-2 border-b">
          {visibleChips.map((s) => (
            <button
              key={s.session_id}
              aria-pressed={enabledSessionIds.has(s.session_id)}
              onClick={() => toggleSession(s.session_id)}
              className="focus:outline-none"
            >
              <Badge
                variant={enabledSessionIds.has(s.session_id) ? "default" : "outline"}
                className="text-[10px] cursor-pointer transition-colors"
              >
                {formatDate(s.started_at)}
              </Badge>
            </button>
          ))}
          {overflowChips.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <button className="focus:outline-none">
                  <Badge variant="outline" className="text-[10px] cursor-pointer">
                    +{overflowChips.length} more
                  </Badge>
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-48 p-2">
                <div className="space-y-1">
                  {overflowChips.map((s) => (
                    <button
                      key={s.session_id}
                      aria-pressed={enabledSessionIds.has(s.session_id)}
                      onClick={() => toggleSession(s.session_id)}
                      className="flex items-center gap-2 w-full px-2 py-1 rounded hover:bg-accent text-xs focus:outline-none"
                    >
                      <Badge
                        variant={enabledSessionIds.has(s.session_id) ? "default" : "outline"}
                        className="text-[9px]"
                      >
                        {enabledSessionIds.has(s.session_id) ? "✓" : ""}
                      </Badge>
                      <span className="truncate">{formatDate(s.started_at)}</span>
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="space-y-2">
          {messages.length === 0 && (
            <div className="text-center text-muted-foreground text-xs py-8">
              Ask about {topicName}...
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={cn(
              "max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words",
              m.role === "user"
                ? "ml-auto bg-primary text-primary-foreground rounded-br-sm"
                : "bg-muted rounded-bl-sm"
            )}>
              {m.content || (streaming && i === messages.length - 1 ? "..." : "")}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="shrink-0 flex gap-2 p-3 border-t">
        <Input
          ref={inputRef}
          aria-label="Chat message"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder={`Ask about ${topicName}...`}
          disabled={streaming}
          className="text-sm"
        />
        <Button size="sm" onClick={handleSend} disabled={streaming || !input.trim()}>
          Send
        </Button>
      </div>
    </div>
  );
}
```

**Step 2: Verify build**

```bash
cd src/web/ui && npm run build
```

Expected: PASS

**Step 3: Commit**

```bash
git add src/web/ui/src/components/ChatPanel.tsx
git commit -m "feat(web): rewrite chat panel with session context chips"
```

---

### Task 4: Reorder TopicDetail sections — sessions before insights

**Files:**
- Modify: `src/web/ui/src/components/TopicDetail.tsx`

**Step 1: Reorder sections**

Move the sessions and related topics sections to render AFTER the header/summary and BEFORE insights. Remove `ScrollArea` wrapper (parent `ResizablePanel` handles scroll). Remove `onSessionClick` from props (sessions no longer navigate away).

The section order becomes:
1. Header (name + summary)
2. Sessions
3. Related topics
4. Insights by category
5. Files

```tsx
// Remove ScrollArea import
// Remove onSessionClick from Props interface
// Props becomes:
interface Props {
  topicId: string | null;
  onTopicClick: (topicId: string) => void;
}

// In the JSX return, change the wrapper and reorder:
return (
  <div className="max-w-2xl p-6 space-y-6">
    {/* 1. Header */}
    <div>
      <h2 className="text-xl font-semibold tracking-tight">{detail.topic.name}</h2>
      <p className="text-sm text-muted-foreground leading-relaxed mt-1">{detail.topic.summary}</p>
    </div>

    {/* 2. Sessions */}
    {detail.sessions.length > 0 && (
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sessions</h3>
        <div className="space-y-1">
          {detail.sessions.map((s) => (
            <div key={s.session_id} className="flex items-center gap-3 py-2 px-3 rounded hover:bg-accent/50">
              <span className="text-xs text-muted-foreground shrink-0 w-12">{formatDate(s.started_at)}</span>
              <span className="text-sm truncate flex-1">{truncate(s.summary || s.session_shape || "Session", 80)}</span>
              <span className="text-xs text-muted-foreground shrink-0">{s.moment_count} moments</span>
            </div>
          ))}
        </div>
      </div>
    )}

    {/* 3. Related topics */}
    {detail.relatedTopics.length > 0 && (
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Related</h3>
        <div className="flex flex-wrap gap-2">
          {detail.relatedTopics.map((r) => (
            <Badge key={r.id} variant="outline" className="cursor-pointer hover:bg-accent transition-colors" onClick={() => onTopicClick(r.id)}>
              {r.name}
            </Badge>
          ))}
        </div>
      </div>
    )}

    {/* 4. Insights by category */}
    {CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((cat) => (
      <div key={cat} className="space-y-2">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${CATEGORY_COLORS[cat]}`} />
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{cat}</span>
          <span className="text-xs text-muted-foreground">({byCategory.get(cat)!.length})</span>
        </div>
        {byCategory.get(cat)!.map((insight, i) => (
          <Card key={i} className="p-3">
            <p className="text-sm leading-relaxed">{insight.statement}</p>
          </Card>
        ))}
      </div>
    ))}

    {/* 5. Files */}
    {detail.files.length > 0 && (
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Files</h3>
        <div className="space-y-1">
          {detail.files.map((f, i) => (
            <div key={i} className="flex items-baseline gap-2">
              <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{f.file_path}</code>
              {f.role && <Badge variant="secondary" className="text-[10px]">{f.role}</Badge>}
            </div>
          ))}
        </div>
      </div>
    )}
  </div>
);
```

**Step 2: Update App.tsx to pass new props**

In `App.tsx`, change the `TopicDetail` usage — remove `onSessionClick`:

```tsx
<TopicDetail
  topicId={selectedTopicId}
  onTopicClick={navigateToTopic}
/>
```

**Step 3: Verify build**

```bash
cd src/web/ui && npm run build
```

Expected: PASS

**Step 4: Commit**

```bash
git add src/web/ui/src/components/TopicDetail.tsx src/web/ui/src/App.tsx
git commit -m "feat(web): reorder topic detail — sessions before insights"
```

---

### Task 5: Backend — Set commit_sha on brain version creation + timeline API

**Files:**
- Modify: `src/cli/index.ts:116` — pass current HEAD sha to `createBrainVersion`
- Modify: `src/web/server.ts` — add `GET /api/timeline` endpoint
- Modify: `src/web/ui/src/api.ts` — add `fetchTimeline` function
- Modify: `src/web/ui/src/types.ts` — add `TimelineEntry` type

**Step 1: Pass commit SHA to createBrainVersion**

In `src/cli/index.ts`, at line 116 where `createBrainVersion(repoId)` is called, get the current HEAD sha first:

```typescript
// Before the createBrainVersion call, add:
const { execSync } = await import("node:child_process");
let commitSha: string | undefined;
try {
  // Get HEAD sha from the project's source path
  const projectPath = session.source_path ? dirname(session.source_path) : process.cwd();
  commitSha = execSync("git rev-parse HEAD", { cwd: projectPath, encoding: "utf-8" }).trim();
} catch { /* not a git repo, skip */ }

const versionId = await createBrainVersion(repoId, commitSha);
```

**Step 2: Add timeline API endpoint**

In `src/web/server.ts`, add before the SPA fallback:

```typescript
app.get("/api/timeline", async (req, res) => {
  const repoId = req.query.repoId as string;
  if (!repoId) return res.status(400).json({ error: "repoId required" });

  const sql = getClient();

  // Get brain versions for this repo
  const versions = await sql`
    SELECT bv.id, bv.commit_sha, bv.created_at,
      (SELECT count(*) FROM topics t WHERE t.repo_id = bv.repo_id AND t.created_at <= bv.created_at) as topic_count,
      (SELECT count(*) FROM insights i JOIN topics t ON i.topic_id = t.id WHERE t.repo_id = bv.repo_id AND i.created_at <= bv.created_at) as insight_count
    FROM brain_versions bv
    WHERE bv.repo_id = ${repoId}
    ORDER BY bv.created_at DESC
  `;

  // Get project source_path to run git log
  const [project] = await sql`SELECT path FROM projects WHERE id = ${repoId}`;
  let commits: Array<{ sha: string; message: string; date: string }> = [];

  if (project?.path) {
    try {
      const { execSync } = await import("node:child_process");
      const log = execSync(
        'git log --pretty=format:"%H|%s|%aI" -20',
        { cwd: project.path, encoding: "utf-8" }
      );
      commits = log.trim().split("\n").filter(Boolean).map((line) => {
        const [sha, message, date] = line.split("|");
        return { sha, message, date };
      });
    } catch { /* not a git repo */ }
  }

  res.json({ commits, brainVersions: versions });
});
```

**Step 3: Add frontend types and API function**

In `src/web/ui/src/types.ts`, add:

```typescript
export interface TimelineCommit {
  sha: string;
  message: string;
  date: string;
}

export interface BrainVersion {
  id: string;
  commit_sha: string | null;
  created_at: string;
  topic_count: number;
  insight_count: number;
}

export interface TimelineData {
  commits: TimelineCommit[];
  brainVersions: BrainVersion[];
}
```

In `src/web/ui/src/api.ts`, add:

```typescript
export const fetchTimeline = (repoId: string) =>
  json<TimelineData>(`/api/timeline?repoId=${repoId}`);
```

**Step 4: Verify build**

```bash
cd src/web/ui && npm run build
```

**Step 5: Commit**

```bash
git add src/cli/index.ts src/web/server.ts src/web/ui/src/api.ts src/web/ui/src/types.ts
git commit -m "feat: add timeline API + set commit_sha on brain versions"
```

---

### Task 6: Create BranchTimeline component

**Files:**
- Create: `src/web/ui/src/components/BranchTimeline.tsx`

**Step 1: Implement BranchTimeline**

```tsx
import { useState, useEffect } from "react";
import { fetchTimeline } from "../api";
import type { TimelineData, BrainVersion } from "../types";
import { Badge } from "@/components/ui/badge";
import { Brain } from "lucide-react";

interface Props {
  repoId: string;
}

export function BranchTimeline({ repoId }: Props) {
  const [data, setData] = useState<TimelineData | null>(null);

  useEffect(() => {
    fetchTimeline(repoId).then(setData).catch(() => setData(null));
  }, [repoId]);

  if (!data) return null;

  // Index brain versions by commit_sha for O(1) lookup
  const versionBySha = new Map<string, BrainVersion>();
  for (const v of data.brainVersions) {
    if (v.commit_sha) versionBySha.set(v.commit_sha, v);
  }

  // Number versions (oldest = v1)
  const versionNumbers = new Map<string, number>();
  const sorted = [...data.brainVersions].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  sorted.forEach((v, i) => versionNumbers.set(v.id, i + 1));

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <div className="space-y-0">
      {data.commits.map((commit) => {
        const version = versionBySha.get(commit.sha);
        const vNum = version ? versionNumbers.get(version.id) : null;

        return (
          <div key={commit.sha} className="flex gap-3 group">
            {/* Timeline line + dot */}
            <div className="flex flex-col items-center w-4 shrink-0">
              <div className={`w-2 h-2 rounded-full mt-2 ${version ? "bg-emerald-500" : "bg-muted-foreground/30"}`} />
              <div className="w-px flex-1 bg-border" />
            </div>

            {/* Content */}
            <div className={`pb-4 min-w-0 ${version ? "" : "opacity-50"}`}>
              <div className="flex items-center gap-2">
                <code className="text-[11px] text-muted-foreground font-mono">{commit.sha.slice(0, 7)}</code>
                <span className="text-sm truncate">{commit.message}</span>
                {version && vNum && (
                  <Badge variant="secondary" className="shrink-0 text-[10px] gap-1">
                    <Brain className="size-3" />
                    v{vNum}
                  </Badge>
                )}
              </div>
              {version && (
                <div className="text-xs text-muted-foreground mt-0.5 ml-[52px]">
                  {version.topic_count} topics, {version.insight_count} insights
                </div>
              )}
              <div className="text-[10px] text-muted-foreground/60 mt-0.5">{formatDate(commit.date)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

**Step 2: Verify build**

```bash
cd src/web/ui && npm run build
```

**Step 3: Commit**

```bash
git add src/web/ui/src/components/BranchTimeline.tsx
git commit -m "feat(web): add branch timeline component with brain version tags"
```

---

### Task 7: Integrate BranchTimeline into OverviewPanel

**Files:**
- Modify: `src/web/ui/src/components/OverviewPanel.tsx`

**Step 1: Add timeline to overview**

Add `repoId` to OverviewPanel props. Import and render `BranchTimeline` as the main content section, replacing the "recent sessions" list.

```tsx
// Add to Props:
interface Props {
  topics: TopicSummary[];
  sessions: Session[];
  repoId: string | null;
  onTopicClick: (id: string) => void;
}

// In the JSX, replace the "Recent Sessions" section with:
{repoId && (
  <div className="space-y-3">
    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Branch Timeline</h3>
    <BranchTimeline repoId={repoId} />
  </div>
)}
```

**Step 2: Update App.tsx to pass repoId**

```tsx
<OverviewPanel
  topics={topics}
  sessions={sessions}
  repoId={selectedProject?.id ?? null}
  onTopicClick={handleTopicSelect}
/>
```

**Step 3: Verify build**

```bash
cd src/web/ui && npm run build
```

**Step 4: Commit**

```bash
git add src/web/ui/src/components/OverviewPanel.tsx src/web/ui/src/App.tsx
git commit -m "feat(web): integrate branch timeline into overview page"
```

---

### Task 8: Delete unused files, clean up, verify

**Files:**
- Delete: `src/web/ui/src/components/SessionPanel.tsx`
- Delete: `src/web/ui/src/components/SessionList.tsx`

**Step 1: Delete files**

```bash
rm src/web/ui/src/components/SessionPanel.tsx
rm src/web/ui/src/components/SessionList.tsx
```

**Step 2: Remove any remaining imports**

Check `App.tsx` has no imports of `SessionPanel` or `SessionList`. They should already be removed from Task 1.

**Step 3: Verify build**

```bash
cd src/web/ui && npm run build
```

Expected: PASS, no warnings about missing imports.

**Step 4: Run full test suite**

```bash
npx vitest run
```

Expected: 120 tests pass (no web tests to break, pipeline tests unaffected).

**Step 5: Commit**

```bash
git add -A src/web/ui
git commit -m "feat(web): remove SessionPanel + SessionList, clean up"
```

---

### Task 9: Build, test with server, final commit

**Step 1: Full build**

```bash
cd src/web/ui && npm run build
```

**Step 2: Start server and verify**

```bash
npx tsx src/cli/index.ts web --port 3456
```

Open `localhost:3456` and verify:
- Overview shows stats + recent topics + branch timeline with brain version tags
- Click topic → split view (detail left, chat right)
- Breadcrumb shows `Overview > Topic Name`, clicking Overview goes back
- Chat header shows "Chat: {topic name}"
- Session chips load, 3 most recent are ON (filled badge)
- Toggling chips changes their visual state
- Chat collapse/expand button in header works
- Resizable handle lets you drag between panels
- Topic list in sidebar has search
- Sidebar collapses to icons

**Step 3: Commit**

```bash
git add -A src/web/
git commit -m "feat(web): complete split-view dashboard redesign"
```
