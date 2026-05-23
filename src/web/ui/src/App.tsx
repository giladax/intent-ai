import { useState, useEffect, useCallback } from "react";
import { Header } from "./components/Header";
import { TopicList } from "./components/TopicList";
import { TopicDetail } from "./components/TopicDetail";
import { SessionList } from "./components/SessionList";
import { SessionPanel } from "./components/SessionPanel";
import { ChatPanel } from "./components/ChatPanel";
import { fetchProjects, fetchTopics, fetchSessions } from "./api";
import type { Project, TopicSummary, Session } from "./types";

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

  return (
    <div className="app">
      <Header
        projects={projects}
        selectedProject={selectedProject}
        onProjectChange={handleProjectChange}
        onProjectCreated={handleProjectCreated}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
      <div className="sidebar">
        {activeTab === "brain" ? (
          <TopicList
            topics={topics}
            selectedTopicId={selectedTopicId}
            onSelectTopic={handleTopicSelect}
          />
        ) : (
          <SessionList
            sessions={sessions}
            selectedSessionId={selectedSessionId}
            onSelectSession={handleSessionSelect}
            topics={topics}
            onTopicClick={navigateToTopic}
          />
        )}
      </div>
      <div className="detail">
        {activeTab === "brain" ? (
          <TopicDetail
            topicId={selectedTopicId}
            onSessionClick={navigateToSession}
            onTopicClick={navigateToTopic}
          />
        ) : (
          <SessionPanel
            sessionId={selectedSessionId}
          />
        )}
      </div>
      <ChatPanel
        topicId={chatTopicId}
        sessionId={chatSessionId}
        scopeLabel={chatLabel}
      />
    </div>
  );
}
