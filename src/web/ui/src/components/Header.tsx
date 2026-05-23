import { useState } from "react";
import { createProject } from "../api";
import type { Project } from "../types";

interface Props {
  projects: Project[];
  selectedProject: Project | null;
  onProjectChange: (p: Project) => void;
  onProjectCreated: (p: Project) => void;
  activeTab: "brain" | "sessions";
  onTabChange: (tab: "brain" | "sessions") => void;
}

export function Header({
  projects,
  selectedProject,
  onProjectChange,
  onProjectCreated,
  activeTab,
  onTabChange,
}: Props) {
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPath, setNewPath] = useState("");

  const handleCreate = async () => {
    if (!newName.trim() || !newPath.trim()) return;
    const p = await createProject(newName.trim(), newPath.trim());
    onProjectCreated(p);
    setShowNew(false);
    setNewName("");
    setNewPath("");
  };

  return (
    <header className="header">
      <span className="header-brand">intent</span>

      <div className="header-controls">
        <select
          value={selectedProject?.id ?? ""}
          onChange={(e) => {
            const p = projects.find((p) => p.id === e.target.value);
            if (p) onProjectChange(p);
          }}
        >
          {projects.length === 0 && <option value="">No projects</option>}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <button className="btn-small" onClick={() => setShowNew(!showNew)}>+</button>
      </div>

      <div className="header-tabs">
        <button
          className={`tab-btn ${activeTab === "brain" ? "active" : ""}`}
          onClick={() => onTabChange("brain")}
        >
          Brain
        </button>
        <button
          className={`tab-btn ${activeTab === "sessions" ? "active" : ""}`}
          onClick={() => onTabChange("sessions")}
        >
          Sessions
        </button>
      </div>

      {showNew && (
        <div className="header-new-project">
          <input placeholder="name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <input placeholder="path" value={newPath} onChange={(e) => setNewPath(e.target.value)} />
          <button className="btn-small" onClick={handleCreate}>Create</button>
          <button className="btn-small" onClick={() => setShowNew(false)}>Cancel</button>
        </div>
      )}
    </header>
  );
}
