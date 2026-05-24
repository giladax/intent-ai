import { useState, useEffect, useCallback } from "react";
import { TopicList } from "./components/TopicList";
import { TopicDetail } from "./components/TopicDetail";
import { ChatPanel } from "./components/ChatPanel";
import { OverviewPanel } from "./components/OverviewPanel";
import { BrainSync } from "./components/BrainSync";
import { SyncDiffTree } from "./components/SyncDiffTree";
import { fetchProjects, fetchTopics, fetchSessions } from "./api";
import type { Project, TopicSummary, Session, BrainSyncProposal } from "./types";
import { Brain as BrainIcon, ChevronDown, MessageSquare, X, RefreshCw, Layers, ScrollText } from "lucide-react";
import {
  SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarFooter,
  SidebarMenu, SidebarMenuItem, SidebarMenuButton,
  SidebarTrigger, SidebarInset,
  SidebarGroup, SidebarGroupLabel, SidebarGroupContent, SidebarSeparator,
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
import { Badge } from "@/components/ui/badge";

type View = "overview" | "topic" | "sync" | "sessions";

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [topics, setTopics] = useState<TopicSummary[]>([]);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [view, setView] = useState<View>("overview");
  const [reviewProposal, setReviewProposal] = useState<BrainSyncProposal | null>(null);
  const [undigestedCount, setUndigestedCount] = useState(0);

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
    // Check undigested count
    fetch("/api/brain/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoId: selectedProject.id }),
    })
      .then((r) => r.json())
      .then((data) => setUndigestedCount(data.undigestedCount ?? 0))
      .catch(() => {});
  }, [selectedProject]);

  const handleProjectChange = (p: Project) => {
    setSelectedProject(p);
    setSelectedTopicId(null);
    setView("overview");
  };

  const handleTopicSelect = (id: string) => {
    setSelectedTopicId(id);
    setView("topic");
  };

  const navigateToTopic = useCallback((topicId: string) => {
    setSelectedTopicId(topicId);
    setView("topic");
  }, []);

  const handleSyncComplete = useCallback(() => {
    setReviewProposal(null);
    if (selectedProject) {
      fetchTopics(selectedProject.id).then(setTopics).catch(() => setTopics([]));
    }
    setUndigestedCount(0);
    setView("overview");
  }, [selectedProject]);

  const selectedTopicName = topics.find((t) => t.id === selectedTopicId)?.name;

  // Breadcrumb
  const breadcrumbLabel =
    view === "sync" ? "Sync Brain" :
    view === "sessions" ? "Sessions" :
    view === "topic" && selectedTopicName ? selectedTopicName :
    "Overview";

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
          {/* Sessions section */}
          <SidebarGroup>
            <SidebarGroupLabel>
              <ScrollText className="size-3 mr-1" />
              Sessions
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={view === "sessions"}
                    onClick={() => { setView("sessions"); setSelectedTopicId(null); }}
                    className="text-sm"
                  >
                    <span className="flex-1">{sessions.length} digested</span>
                    {undigestedCount > 0 && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                        {undigestedCount} new
                      </Badge>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarSeparator />

          {/* Knowledge Tree */}
          <TopicList
            topics={topics}
            selectedTopicId={view === "topic" ? selectedTopicId : null}
            onSelectTopic={handleTopicSelect}
          />
        </SidebarContent>

        {/* Sync button at bottom */}
        {selectedProject && (
          <SidebarFooter className="p-3">
            <Button
              variant={undigestedCount > 0 ? "default" : "outline"}
              size="sm"
              className="w-full gap-2"
              onClick={() => setView("sync")}
            >
              <RefreshCw className="size-3.5" />
              Sync Brain
              {undigestedCount > 0 && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-auto">
                  {undigestedCount}
                </Badge>
              )}
            </Button>
          </SidebarFooter>
        )}
      </Sidebar>

      <SidebarInset className="h-svh overflow-hidden">
        <header className="sticky top-0 flex h-14 shrink-0 items-center gap-2 border-b bg-background z-10">
          <div className="flex flex-1 items-center gap-2 px-3">
            <SidebarTrigger />
            <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  {view !== "overview" ? (
                    <BreadcrumbLink href="#" onClick={(e) => { e.preventDefault(); setView("overview"); setSelectedTopicId(null); }}>
                      Overview
                    </BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage>Overview</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
                {view !== "overview" && (
                  <>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      <BreadcrumbPage>{breadcrumbLabel}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </>
                )}
              </BreadcrumbList>
            </Breadcrumb>
          </div>
          {view === "topic" && selectedTopicId && (
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
          {/* Sync view — full page */}
          {view === "sync" && selectedProject ? (
            <div className="h-full overflow-y-auto">
              {reviewProposal ? (
                <SyncDiffTree
                  topics={topics}
                  proposal={reviewProposal}
                  onTopicClick={(topicId) => {
                    setReviewProposal(null);
                    handleTopicSelect(topicId);
                  }}
                />
              ) : (
                <div className="max-w-2xl mx-auto p-6">
                  <BrainSync
                    key={`sync-${selectedProject.id}`}
                    repoId={selectedProject.id}
                    onSynced={handleSyncComplete}
                    onReviewChange={setReviewProposal}
                    autoStart
                  />
                </div>
              )}
            </div>

          ) : view === "sessions" ? (
            <div className="h-full overflow-y-auto">
              <div className="max-w-2xl mx-auto p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Sessions</h2>
                  {undigestedCount > 0 && (
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setView("sync")}>
                      <RefreshCw className="size-3" />
                      Digest {undigestedCount} new
                    </Button>
                  )}
                </div>
                {sessions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No digested sessions yet.</p>
                ) : (
                  <div className="space-y-1">
                    {[...sessions]
                      .sort((a, b) => {
                        const da = a.started_at ? new Date(a.started_at).getTime() : 0;
                        const db = b.started_at ? new Date(b.started_at).getTime() : 0;
                        return db - da;
                      })
                      .map((s) => (
                        <div key={s.id} className="flex items-center gap-2 py-2 px-3 rounded hover:bg-muted/40 text-sm">
                          <span className="text-xs text-muted-foreground shrink-0 w-16 tabular-nums">
                            {s.started_at ? new Date(s.started_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}
                          </span>
                          <span className="flex-1 truncate">
                            {s.narrative_summary?.split(/[.!?\n]/)[0] || "No narrative"}
                          </span>
                          {s.session_shape && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">{s.session_shape}</Badge>
                          )}
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>

          ) : view === "overview" ? (
            <OverviewPanel
              topics={topics}
              sessions={sessions}
              repoId={selectedProject?.id ?? null}
              onTopicClick={handleTopicSelect}
              onSyncBrain={() => setView("sync")}
            />

          ) : (
            /* Topic detail */
            <ResizablePanelGroup direction="horizontal" className="h-full">
              <ResizablePanel defaultSize={60} minSize={35}>
                <div className="h-full overflow-y-auto">
                  <TopicDetail
                    topicId={selectedTopicId!}
                    repoId={selectedProject?.id ?? null}
                    topicsNameMap={new Map(topics.map((t) => [t.name, t.id]))}
                    onTopicClick={navigateToTopic}
                  />
                </div>
              </ResizablePanel>
              {!chatCollapsed && (
                <>
                  <ResizableHandle withHandle />
                  <ResizablePanel defaultSize={40} minSize={20}>
                    <ChatPanel
                      topicId={selectedTopicId!}
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
