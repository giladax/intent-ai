import { useState, useEffect, useCallback } from "react";
import { TopicDetail } from "./components/TopicDetail";
import { ChatPanel } from "./components/ChatPanel";
import { OverviewPanel } from "./components/OverviewPanel";
import { BrainSync } from "./components/BrainSync";
import { SyncDiffTree } from "./components/SyncDiffTree";
import { KnowledgeTreePage } from "./components/KnowledgeTreePage";
import { SessionsPage } from "./components/SessionsPage";
import { SessionDetailPage } from "./components/SessionDetailPage";
import { fetchProjects, fetchTopics, fetchSessions } from "./api";
import type { LiveState } from "./api";
import type { Project, TopicSummary, Session, BrainSyncProposal } from "./types";
import { Brain as BrainIcon, ChevronDown, MessageSquare, X, RefreshCw, Layers, ScrollText, LayoutDashboard } from "lucide-react";
import {
  SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarFooter,
  SidebarMenu, SidebarMenuItem, SidebarMenuButton,
  SidebarTrigger, SidebarInset,
  SidebarGroup, SidebarGroupContent, SidebarSeparator,
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

type View = "overview" | "knowledge" | "sessions" | "session-detail" | "topic" | "sync";

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
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [liveState, setLiveState] = useState<LiveState | null>(null);

  // Poll live state from observe daemon
  useEffect(() => {
    const poll = async () => {
      const { fetchLiveState } = await import('./api');
      const state = await fetchLiveState();
      setLiveState(state);
    };
    poll(); // initial
    const interval = setInterval(poll, 5000); // every 5s
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    fetchProjects().then((ps) => {
      setProjects(ps);
      if (ps.length > 0) setSelectedProject(ps[0]);
    });
    // Sessions loaded per-project below
  }, []);

  useEffect(() => {
    if (!selectedProject) { setTopics([]); setSessions([]); return; }
    fetchTopics(selectedProject.id).then(setTopics).catch(() => setTopics([]));
    fetchSessions(selectedProject.id).then(setSessions).catch(() => setSessions([]));
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
    setView("knowledge");
  };

  const handleTopicSelect = useCallback((id: string) => {
    setSelectedTopicId(id);
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

  const selectedSession = sessions.find((s) => s.id === selectedSessionId);
  const selectedSessionLabel = selectedSession
    ? `${selectedSession.started_at ? new Date(selectedSession.started_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}${selectedSession.session_shape ? " · " + selectedSession.session_shape : ""}`
    : "Session";

  const breadcrumbLabel =
    view === "sync" ? "Sync Brain" :
    view === "sessions" ? "Sessions" :
    view === "session-detail" ? selectedSessionLabel :
    view === "topic" && selectedTopicName ? selectedTopicName :
    view === "knowledge" ? "Knowledge Tree" :
    "Overview";

  // Chat context based on current view
  const chatContext: {
    topicId?: string; topicName?: string;
    sessionId?: string; sessionLabel?: string;
  } | null = view === "topic" && selectedTopicId
    ? { topicId: selectedTopicId, topicName: selectedTopicName ?? "" }
    : view === "session-detail" && selectedSessionId
    ? { sessionId: selectedSessionId, sessionLabel: selectedSessionLabel }
    : null;

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
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {/* Overview */}
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={view === "overview"}
                    onClick={() => { setView("overview"); setSelectedTopicId(null); }}
                    className="text-sm"
                  >
                    <LayoutDashboard className="size-4" />
                    <span>Overview</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>

                {/* Knowledge Tree nav */}
                <SidebarMenuItem className="relative">
                  <SidebarMenuButton
                    isActive={view === "knowledge" || view === "topic"}
                    onClick={() => { setView("knowledge"); setSelectedTopicId(null); }}
                    className="text-sm"
                  >
                    <Layers className="size-4" />
                    <span>Knowledge Tree</span>
                  </SidebarMenuButton>
                  <span className="absolute top-1 right-2 text-[10px] text-muted-foreground tabular-nums">{topics.length}</span>
                </SidebarMenuItem>

                {/* Sessions nav */}
                <SidebarMenuItem className="relative">
                  <SidebarMenuButton
                    isActive={view === "sessions"}
                    onClick={() => { setView("sessions"); setSelectedTopicId(null); }}
                    className="text-sm"
                  >
                    <ScrollText className="size-4" />
                    <span>Sessions</span>
                  </SidebarMenuButton>
                  <span className="absolute top-1 right-2 text-[10px] text-muted-foreground tabular-nums">{sessions.length}</span>
                  {undigestedCount > 0 && (
                    <span className="absolute -top-1 -right-1 flex items-center justify-center size-4 rounded-full bg-primary text-primary-foreground text-[9px] font-semibold">
                      {undigestedCount}
                    </span>
                  )}
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        {/* Sync button at bottom */}
        {selectedProject && (
          <SidebarFooter className="p-3">
            <div className="relative">
              <Button
                variant="outline"
                size="sm"
                className={`w-full gap-2 justify-center ${undigestedCount > 0 ? "overflow-hidden" : ""}`}
                disabled={undigestedCount === 0}
                onClick={() => { setView("sync"); setSelectedTopicId(null); }}
              >
                {undigestedCount > 0 && (
                  <span className="absolute inset-0 bg-gradient-to-r from-primary/0 via-primary/5 to-primary/0 animate-shimmer" />
                )}
                <RefreshCw className={`size-3.5 ${undigestedCount > 0 ? "animate-spin-slow" : ""}`} />
                <span>{undigestedCount > 0 ? "Sync Brain" : "Brain up to date"}</span>
              </Button>
              {undigestedCount > 0 && (
                <span className="absolute -top-2 -right-2 flex items-center justify-center size-5 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold">
                  {undigestedCount}
                </span>
              )}
            </div>
          </SidebarFooter>
        )}
      </Sidebar>

      <SidebarInset className="h-svh overflow-hidden">
        <header className="sticky top-0 flex h-12 shrink-0 items-center gap-2 border-b bg-background z-10">
          <div className="flex flex-1 items-center gap-2 px-3">
            <SidebarTrigger />
            <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  {view === "topic" ? (
                    <BreadcrumbLink href="#" onClick={(e) => { e.preventDefault(); setView("knowledge"); setSelectedTopicId(null); }}>
                      Knowledge Tree
                    </BreadcrumbLink>
                  ) : view === "session-detail" ? (
                    <BreadcrumbLink href="#" onClick={(e) => { e.preventDefault(); setView("sessions"); setSelectedSessionId(null); }}>
                      Sessions
                    </BreadcrumbLink>
                  ) : view !== "overview" ? (
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
                      <BreadcrumbPage className="max-w-[300px] truncate">{view === "topic" ? selectedTopicName : breadcrumbLabel}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </>
                )}
              </BreadcrumbList>
            </Breadcrumb>
          </div>
          <Button
            variant="ghost" size="sm"
            className="mr-3"
            onClick={() => setChatCollapsed(!chatCollapsed)}
          >
            {chatCollapsed ? <MessageSquare className="size-4" /> : <X className="size-4" />}
            <span className="ml-1 text-xs">{chatCollapsed ? "Chat" : "Close"}</span>
          </Button>
        </header>

        <div className="flex-1 overflow-hidden">
          <ResizablePanelGroup direction="horizontal" className="h-full">
            <ResizablePanel defaultSize={chatCollapsed ? 100 : 65} minSize={35}>
              <div className="h-full overflow-y-auto">
                {view === "sync" && selectedProject ? (
                  reviewProposal ? (
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
                      <h2 className="text-lg font-semibold mb-4">Sync Brain</h2>
                      <BrainSync
                        key={`sync-${selectedProject.id}`}
                        repoId={selectedProject.id}
                        onSynced={handleSyncComplete}
                        onReviewChange={setReviewProposal}
                        autoStart
                      />
                    </div>
                  )
                ) : view === "session-detail" && selectedSessionId ? (
                  <SessionDetailPage
                    sessionId={selectedSessionId}
                    onTopicClick={handleTopicSelect}
                  />
                ) : view === "sessions" ? (
                  <SessionsPage
                    sessions={sessions}
                    undigestedCount={undigestedCount}
                    liveState={liveState}
                    onSync={() => setView("sync")}
                    onSessionClick={(id) => {
                      if (id === 'live') {
                        console.log('[live-session] clicked live session row', liveState?.state?.sessionId);
                        return;
                      }
                      setSelectedSessionId(id);
                      setView("session-detail");
                    }}
                  />
                ) : view === "overview" ? (
                  <OverviewPanel
                    topics={topics}
                    sessions={sessions}
                    repoId={selectedProject?.id ?? null}
                    onTopicClick={handleTopicSelect}
                    onSyncBrain={() => setView("sync")}
                  />
                ) : view === "topic" && selectedTopicId ? (
                  <TopicDetail
                    topicId={selectedTopicId}
                    repoId={selectedProject?.id ?? null}
                    topicsNameMap={new Map(topics.map((t) => [t.name, t.id]))}
                    onTopicClick={handleTopicSelect}
                  />
                ) : (
                  <KnowledgeTreePage
                    topics={topics}
                    sessions={sessions}
                    repoId={selectedProject?.id ?? null}
                    onTopicClick={handleTopicSelect}
                    onSync={() => setView("sync")}
                    undigestedCount={undigestedCount}
                  />
                )}
              </div>
            </ResizablePanel>

            {!chatCollapsed && (
              <>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={35} minSize={20}>
                  <ChatPanel
                    topicId={chatContext?.topicId ?? null}
                    topicName={chatContext?.topicName ?? ""}
                    sessionId={chatContext?.sessionId ?? null}
                    sessionLabel={chatContext?.sessionLabel ?? ""}
                    liveState={liveState}
                  />
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
