import { useState, useEffect, useCallback } from "react";
import { Header } from "./components/Header";
import { FeatureList } from "./components/FeatureList";
import { SessionPanel } from "./components/SessionPanel";
import { ChatPanel } from "./components/ChatPanel";
import { fetchProjects, fetchFeatures, fetchSessions } from "./api";
import type { Project, Feature, Session } from "./types";

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
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

  // Load features when project changes
  useEffect(() => {
    if (!selectedProject) {
      setFeatures([]);
      return;
    }
    fetchFeatures(selectedProject.id).then(setFeatures);
  }, [selectedProject]);

  const refreshFeatures = useCallback(() => {
    if (selectedProject) {
      fetchFeatures(selectedProject.id).then(setFeatures);
    }
  }, [selectedProject]);

  const refreshSessions = useCallback(() => {
    fetchSessions().then(setSessions);
  }, []);

  const handleProjectChange = (p: Project) => {
    setSelectedProject(p);
    setSelectedFeatureId(null);
    setSelectedSessionId(null);
  };

  const handleProjectCreated = (p: Project) => {
    setProjects((prev) => [p, ...prev]);
    setSelectedProject(p);
  };

  return (
    <div className="app">
      <Header
        projects={projects}
        selectedProject={selectedProject}
        onProjectChange={handleProjectChange}
        onProjectCreated={handleProjectCreated}
        sessionCount={sessions.length}
      />
      <FeatureList
        features={features}
        selectedFeatureId={selectedFeatureId}
        onSelectFeature={setSelectedFeatureId}
        projectId={selectedProject?.id ?? null}
        onFeatureCreated={refreshFeatures}
        sessions={sessions}
      />
      <SessionPanel
        featureId={selectedFeatureId}
        sessions={sessions}
        selectedSessionId={selectedSessionId}
        onSelectSession={setSelectedSessionId}
        onTagChanged={() => { refreshFeatures(); refreshSessions(); }}
      />
      <ChatPanel
        featureId={selectedFeatureId}
        sessionId={selectedSessionId}
        featureName={features.find((f) => f.id === selectedFeatureId)?.name}
      />
    </div>
  );
}
