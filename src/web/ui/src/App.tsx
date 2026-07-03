import { useState, useEffect, useCallback } from "react";
import "@fontsource-variable/newsreader";
import "@fontsource-variable/newsreader/wght-italic.css";
import "./app-ink.css";
import { TopicDetail } from "./components/TopicDetail";
import { ChatDock } from "./components/ChatDock";
import { TalkLayer } from "./components/TalkLayer";
import { ChatDockProvider, useChatDock } from "./chat-dock";
import { BrainSync } from "./components/BrainSync";
import { SyncDiffTree } from "./components/SyncDiffTree";
import { KnowledgeTreePage } from "./components/KnowledgeTreePage";
import { SessionsPage } from "./components/SessionsPage";
import { SessionDetailPage } from "./components/SessionDetailPage";
import { FeaturesPage } from "./components/FeaturesPage";
import { FeatureDetail } from "./components/FeatureDetail";
import { ReviewQueue } from "./components/ReviewQueue";
import { JournalPage } from "./components/JournalPage";
import { fetchProjects, fetchTopics, fetchSessions, fetchFeatures, fetchPendingObservations } from "./api";
import type { LiveState } from "./api";
import type { Project, TopicSummary, Session, Feature, BrainSyncProposal } from "./types";
import { Brain as BrainIcon, ChevronDown, MessageSquare, X, RefreshCw, ScrollText, Boxes, Inbox, BookOpen } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type View =
  | "journal"
  | "features"
  | "feature-detail"
  | "review"
  | "knowledge"
  | "sessions"
  | "session-detail"
  | "topic"
  | "sync";

export function App() {
  return (
    <ChatDockProvider>
      <AppShell />
    </ChatDockProvider>
  );
}

function AppShell() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [topics, setTopics] = useState<TopicSummary[]>([]);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [view, setView] = useState<View>("journal");
  const [reviewProposal, setReviewProposal] = useState<BrainSyncProposal | null>(null);
  const [undigestedCount, setUndigestedCount] = useState(0);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
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
    if (!selectedProject) { setTopics([]); setSessions([]); setFeatures([]); setPendingCount(0); return; }
    fetchTopics(selectedProject.id).then(setTopics).catch(() => setTopics([]));
    fetchSessions(selectedProject.id).then(setSessions).catch(() => setSessions([]));
    fetchFeatures(selectedProject.id).then(setFeatures).catch(() => setFeatures([]));
    fetchPendingObservations(selectedProject.id)
      .then((obs) => setPendingCount(obs.length))
      .catch(() => setPendingCount(0));
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
    setView("journal");
  };

  const handleTopicSelect = useCallback((id: string) => {
    setSelectedTopicId(id);
    setView("topic");
  }, []);

  const handleFeatureSelect = useCallback((id: string) => {
    setSelectedFeatureId(id);
    setView("feature-detail");
  }, []);

  const handleSyncComplete = useCallback(() => {
    setReviewProposal(null);
    if (selectedProject) {
      fetchTopics(selectedProject.id).then(setTopics).catch(() => setTopics([]));
    }
    setUndigestedCount(0);
    setView("journal");
  }, [selectedProject]);

  const selectedTopicName = topics.find((t) => t.id === selectedTopicId)?.name;
  const selectedFeatureName = features.find((f) => f.id === selectedFeatureId)?.name;

  const selectedSession = sessions.find((s) => s.id === selectedSessionId);
  const selectedSessionLabel = selectedSession
    ? `${selectedSession.started_at ? new Date(selectedSession.started_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}${selectedSession.session_shape ? " · " + selectedSession.session_shape : ""}`
    : "Session";

  const breadcrumbLabel =
    view === "sync" ? "Sync Brain" :
    view === "features" ? "Features" :
    view === "feature-detail" ? (selectedFeatureName ?? "Feature") :
    view === "review" ? "Review" :
    view === "sessions" ? "Sessions" :
    view === "session-detail" ? selectedSessionLabel :
    view === "topic" && selectedTopicName ? selectedTopicName :
    view === "knowledge" ? "Knowledge Tree" :
    "Overview";

  // The chat dock follows navigation — whatever you're reading is its context.
  const { setAutoItem } = useChatDock();
  useEffect(() => {
    if (view === "feature-detail" && selectedFeatureId) {
      setAutoItem({ kind: "feature", id: selectedFeatureId, label: selectedFeatureName ?? "this feature", auto: true });
    } else if (view === "session-detail" && selectedSessionId) {
      setAutoItem({ kind: "session", id: selectedSessionId, label: selectedSessionLabel, auto: true });
    } else if (view === "topic" && selectedTopicId) {
      setAutoItem({ kind: "topic", id: selectedTopicId, label: selectedTopicName ?? "this topic", auto: true });
    } else {
      setAutoItem(null);
    }
  }, [view, selectedFeatureId, selectedFeatureName, selectedSessionId, selectedSessionLabel, selectedTopicId, selectedTopicName, setAutoItem]);

  return (
    <SidebarProvider className="ink-app">
      <Sidebar side="left" collapsible="icon" className="border-r-0">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton className="h-10">
                    <BrainIcon className="size-4" />
                    <span className="ink-wordmark">{selectedProject?.name ?? "Brain"}</span>
                    <ChevronDown className="ml-auto size-3.5 opacity-50" />
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
                {/* Journal (landing / front door) */}
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={view === "journal"}
                    onClick={() => { setView("journal"); setSelectedTopicId(null); }}
                  >
                    <BookOpen className="size-4" />
                    <span className="ink-nav-label">Journal</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>

                {/* Features nav (primary node) */}
                <SidebarMenuItem className="relative">
                  <SidebarMenuButton
                    isActive={view === "features" || view === "feature-detail"}
                    onClick={() => { setView("features"); setSelectedFeatureId(null); }}
                  >
                    <Boxes className="size-4" />
                    <span className="ink-nav-label">Features</span>
                  </SidebarMenuButton>
                  <span className="ink-nav-count absolute top-1/2 -translate-y-1/2 right-2">{features.length}</span>
                </SidebarMenuItem>

                {/* Review nav — the human gate */}
                <SidebarMenuItem className="relative">
                  <SidebarMenuButton
                    isActive={view === "review"}
                    onClick={() => { setView("review"); setSelectedTopicId(null); }}
                  >
                    <Inbox className="size-4" />
                    <span className="ink-nav-label">Review</span>
                  </SidebarMenuButton>
                  {pendingCount > 0 && (
                    <span className="ink-badge-red absolute top-1/2 -translate-y-1/2 right-2">{pendingCount}</span>
                  )}
                </SidebarMenuItem>

                {/* Sessions nav */}
                <SidebarMenuItem className="relative">
                  <SidebarMenuButton
                    isActive={view === "sessions" || view === "session-detail"}
                    onClick={() => { setView("sessions"); setSelectedTopicId(null); }}
                  >
                    <ScrollText className="size-4" />
                    <span className="ink-nav-label">Sessions</span>
                  </SidebarMenuButton>
                  <span className="ink-nav-count absolute top-1/2 -translate-y-1/2 right-2">{sessions.length}</span>
                  {undigestedCount > 0 && (
                    <span className="ink-badge-red absolute -top-0.5 right-1">{undigestedCount}</span>
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
        <header className="ink-bar sticky top-0 flex h-12 shrink-0 items-center gap-2 z-10">
          <div className="flex flex-1 items-center gap-2 px-3">
            <SidebarTrigger />
            <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
            <Breadcrumb className="ink-crumb">
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
                  ) : view === "feature-detail" ? (
                    <BreadcrumbLink href="#" onClick={(e) => { e.preventDefault(); setView("features"); setSelectedFeatureId(null); }}>
                      Features
                    </BreadcrumbLink>
                  ) : view !== "journal" ? (
                    <BreadcrumbLink href="#" onClick={(e) => { e.preventDefault(); setView("journal"); setSelectedTopicId(null); }}>
                      Journal
                    </BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage>Journal</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
                {view !== "journal" && (
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
          <AskBrainButton />
        </header>

        <div className="flex-1 overflow-hidden">
          <div className="h-full overflow-y-auto">
                {view === "journal" ? (
                  <JournalPage
                    repoId={selectedProject?.id ?? null}
                    features={features}
                    onSessionClick={(id) => { setSelectedSessionId(id); setView("session-detail"); }}
                    onFeatureClick={handleFeatureSelect}
                    onReviewClick={() => { setView("review"); setSelectedTopicId(null); }}
                  />
                ) : view === "sync" && selectedProject ? (
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
                ) : view === "review" ? (
                  <ReviewQueue
                    repoId={selectedProject?.id ?? null}
                    onFeatureClick={handleFeatureSelect}
                  />
                ) : view === "feature-detail" && selectedFeatureId ? (
                  <FeatureDetail
                    featureId={selectedFeatureId}
                    onSessionClick={(id) => { setSelectedSessionId(id); setView("session-detail"); }}
                  />
                ) : view === "features" ? (
                  <FeaturesPage
                    repoId={selectedProject?.id ?? null}
                    onFeatureClick={handleFeatureSelect}
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
        </div>
      </SidebarInset>

      {/* Always-live conversational layer */}
      <ChatDock liveState={liveState} />
      <TalkLayer />
    </SidebarProvider>
  );
}

// The header toggle — reads pinned-count so the button itself tells the story.
function AskBrainButton() {
  const { open, toggleDock, items } = useChatDock();
  return (
    <button
      className="mr-3 inline-flex items-center gap-1.5"
      style={{
        fontFamily: "var(--j-mono)", fontSize: "0.625rem", letterSpacing: "0.14em",
        textTransform: "uppercase", border: "1px solid var(--j-hairline)", borderRadius: 999,
        padding: "0.3rem 0.75rem", color: open ? "var(--j-paper)" : "var(--j-ink-soft)",
        background: open ? "var(--j-ink)" : "transparent", cursor: "pointer",
      }}
      title="⌘J"
      onClick={toggleDock}
    >
      {open ? <X className="size-3" /> : <MessageSquare className="size-3" />}
      {open ? "Close" : items.length > 0 ? `Correspondence · ${items.length}` : "Ask the Brain"}
    </button>
  );
}
