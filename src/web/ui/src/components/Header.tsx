import { useState } from "react";
import { createProject } from "../api";
import type { Project } from "../types";

interface Props {
  projects: Project[];
  selectedProject: Project | null;
  onProjectChange: (p: Project) => void;
  onProjectCreated: (p: Project) => void;
  sessionCount: number;
}

export function Header({ projects, selectedProject, onProjectChange, onProjectCreated, sessionCount }: Props) {
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
      <div className="header-brand">intent</div>
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
        <button className="btn-small" onClick={() => setShowNew(!showNew)}>+ Project</button>
        <span className="header-stat">{sessionCount} sessions</span>
      </div>
      {showNew && (
        <div className="header-new-project">
          <input placeholder="Project name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <input placeholder="Project path" value={newPath} onChange={(e) => setNewPath(e.target.value)} />
          <button onClick={handleCreate}>Create</button>
          <button onClick={() => setShowNew(false)}>Cancel</button>
        </div>
      )}
    </header>
  );
}
