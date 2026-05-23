import { useState, useEffect, useCallback } from "react";
import { TopicList } from "./components/TopicList";
import { TopicDetail } from "./components/TopicDetail";
import { SessionList } from "./components/SessionList";
import { SessionPanel } from "./components/SessionPanel";
import { ChatPanel } from "./components/ChatPanel";
import { fetchProjects, fetchTopics, fetchSessions } from "./api";
import type { Project, TopicSummary, Session } from "./types";
import { Brain as BrainIcon, Clock as ClockIcon, ChevronDown } from "lucide-react";
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";

type Tab = "brain" | "sessions";

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("brain");

  // Brain state
  const [topics, setTopics] = useState<TopicSummary[]>([]);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);

  // Sessions state
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  // Load projects on mount
  useEffect(() => {
    fetchProjects().then((ps) => {
      setProjects(ps);
      if (ps.length > 0) setSelectedProject(ps[0]);
    });
    fetchSessions().then(setSessions);
  }, []);

  // Load topics when project changes
  useEffect(() => {
    if (!selectedProject) {
      setTopics([]);
      return;
    }
    fetchTopics(selectedProject.id).then(setTopics).catch(() => setTopics([]));
  }, [selectedProject]);

  const handleProjectChange = (p: Project) => {
    setSelectedProject(p);
    setSelectedTopicId(null);
    setSelectedSessionId(null);
  };

  const handleProjectCreated = (p: Project) => {
    setProjects((prev) => [p, ...prev]);
    setSelectedProject(p);
  };

  const handleTopicSelect = (id: string) => {
    setSelectedTopicId(id);
    setSelectedSessionId(null);
  };

  const handleSessionSelect = (id: string) => {
    setSelectedSessionId(id);
  };

  // Cross-tab navigation
  const navigateToSession = useCallback((sessionId: string) => {
    setActiveTab("sessions");
    setSelectedSessionId(sessionId);
  }, []);

  const navigateToTopic = useCallback((topicId: string) => {
    setActiveTab("brain");
    setSelectedTopicId(topicId);
  }, []);

  // Chat scope
  const chatTopicId = activeTab === "brain" ? selectedTopicId : null;
  const chatSessionId = activeTab === "sessions" ? selectedSessionId : null;
  const chatLabel = activeTab === "brain"
    ? topics.find((t) => t.id === selectedTopicId)?.name
    : undefined;

  // Suppress unused warning — kept for future use
  void handleProjectCreated;

  return (
    <SidebarProvider>
      {/* LEFT SIDEBAR */}
      <Sidebar side="left" collapsible="icon">
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
          {/* Nav toggle */}
          <SidebarGroup>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton isActive={activeTab === "brain"} onClick={() => setActiveTab("brain")}>
                  <BrainIcon className="size-4" />
                  <span>Brain</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton isActive={activeTab === "sessions"} onClick={() => setActiveTab("sessions")}>
                  <ClockIcon className="size-4" />
                  <span>Sessions</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>

          <Separator />

          {/* List content */}
          {activeTab === "brain" ? (
            <TopicList topics={topics} selectedTopicId={selectedTopicId} onSelectTopic={handleTopicSelect} />
          ) : (
            <SessionList sessions={sessions} selectedSessionId={selectedSessionId} onSelectSession={handleSessionSelect} topics={topics} onTopicClick={navigateToTopic} />
          )}
        </SidebarContent>
      </Sidebar>

      {/* MAIN CONTENT */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2 border-b bg-background">
          <SidebarTrigger />
        </div>
        <div className="flex-1 overflow-y-auto">
          {activeTab === "brain" ? (
            <TopicDetail
              topicId={selectedTopicId}
              onSessionClick={navigateToSession}
              onTopicClick={navigateToTopic}
            />
          ) : (
            <SessionPanel sessionId={selectedSessionId} />
          )}
        </div>
      </main>

      {/* RIGHT SIDEBAR — Chat */}
      <Sidebar side="right" collapsible="none">
        <ChatPanel
          topicId={chatTopicId}
          sessionId={chatSessionId}
          scopeLabel={chatLabel}
        />
      </Sidebar>
    </SidebarProvider>
  );
}
