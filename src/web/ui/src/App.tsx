import { useState, useEffect, useCallback } from "react";
import { TopicDetail } from "./components/TopicDetail";
import { ChatPanel } from "./components/ChatPanel";
import { OverviewPanel } from "./components/OverviewPanel";
import { BrainSync } from "./components/BrainSync";
import { SyncDiffTree } from "./components/SyncDiffTree";
import { KnowledgeTreePage } from "./components/KnowledgeTreePage";
import { SessionsPage } from "./components/SessionsPage";
import { fetchProjects, fetchTopics, fetchSessions } from "./api";
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

type View = "overview" | "knowledge" | "sessions" | "topic" | "sync";

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

  const breadcrumbLabel =
    view === "sync" ? "Sync Brain" :
    view === "sessions" ? "Sessions" :
    view === "topic" && selectedTopicName ? selectedTopicName :
    view === "knowledge" ? "Knowledge Tree" :
    "Overview";

  // Chat context based on current view
  const chatContext = view === "topic" && selectedTopicId
    ? { topicId: selectedTopicId, topicName: selectedTopicName ?? "" }
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
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={view === "knowledge" || view === "topic"}
                    onClick={() => { setView("knowledge"); setSelectedTopicId(null); }}
                    className="text-sm"
                  >
                    <Layers className="size-4" />
                    <span className="flex-1">Knowledge Tree</span>
                    <span className="text-[10px] text-muted-foreground tabular-nums">{topics.length}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>

                {/* Sessions nav */}
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={view === "sessions"}
                    onClick={() => { setView("sessions"); setSelectedTopicId(null); }}
                    className="text-sm"
                  >
                    <ScrollText className="size-4" />
                    <span className="flex-1">Sessions</span>
                    <span className="text-[10px] text-muted-foreground tabular-nums">{sessions.length}</span>
                    {undigestedCount > 0 && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                        +{undigestedCount}
                      </Badge>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        {/* Sync button at bottom */}
        {selectedProject && (
          <SidebarFooter className="p-3">
            <Button
              variant="outline"
              size="sm"
              className={`w-full gap-2 ${undigestedCount > 0 ? "border-amber-300 dark:border-amber-600 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30" : ""}`}
              disabled={undigestedCount === 0}
              onClick={() => { setView("sync"); setSelectedTopicId(null); }}
            >
              <RefreshCw className={`size-3.5 ${undigestedCount > 0 ? "animate-spin-slow" : ""}`} />
              {undigestedCount > 0 ? `Sync Brain · ${undigestedCount} new` : "Brain up to date"}
            </Button>
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
                      <BreadcrumbPage>{view === "topic" ? selectedTopicName : breadcrumbLabel}</BreadcrumbPage>
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
                ) : view === "sessions" ? (
                  <SessionsPage
                    sessions={sessions}
                    undigestedCount={undigestedCount}
                    onSync={() => setView("sync")}
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
