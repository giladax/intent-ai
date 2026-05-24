import { useState, useEffect, useCallback } from "react";
import { TopicList } from "./components/TopicList";
import { TopicDetail } from "./components/TopicDetail";
import { ChatPanel } from "./components/ChatPanel";
import { OverviewPanel } from "./components/OverviewPanel";
import { BrainSync } from "./components/BrainSync";
import { fetchProjects, fetchTopics, fetchSessions } from "./api";
import type { Project, TopicSummary, Session } from "./types";
import { Brain as BrainIcon, ChevronDown, MessageSquare, X } from "lucide-react";
import {
  SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarFooter,
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
        {selectedProject && (
          <SidebarFooter className="p-3">
            <BrainSync
              key={selectedProject.id}
              repoId={selectedProject.id}
              onSynced={() => {
                fetchTopics(selectedProject.id).then(setTopics).catch(() => setTopics([]));
              }}
            />
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
              repoId={selectedProject?.id ?? null}
              onTopicClick={handleTopicSelect}
            />
          ) : (
            <ResizablePanelGroup direction="horizontal" className="h-full">
              <ResizablePanel defaultSize={60} minSize={35}>
                <div className="h-full overflow-y-auto">
                  <TopicDetail
                    topicId={selectedTopicId}
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
