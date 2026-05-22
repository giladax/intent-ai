import { useState } from "react";
import { createFeature } from "../api";
import type { Feature, Session } from "../types";

interface Props {
  features: Feature[];
  selectedFeatureId: string | null;
  onSelectFeature: (id: string | null) => void;
  projectId: string | null;
  onFeatureCreated: () => void;
  sessions: Session[];
}

export function FeatureList({ features, selectedFeatureId, onSelectFeature, projectId, onFeatureCreated, sessions }: Props) {
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");

  const handleCreate = async () => {
    if (!newName.trim() || !projectId) return;
    await createFeature(projectId, newName.trim());
    onFeatureCreated();
    setShowNew(false);
    setNewName("");
  };

  // Count untagged sessions
  const taggedSessionIds = new Set<string>();
  for (const s of sessions) {
    if (s.features && s.features.length > 0) {
      taggedSessionIds.add(s.id);
    }
  }
  const untaggedCount = sessions.length - taggedSessionIds.size;

  return (
    <aside className="features">
      <div className="features-header">
        <span className="features-title">Features</span>
        {projectId && (
          <button className="btn-small" onClick={() => setShowNew(!showNew)}>+</button>
        )}
      </div>
      {showNew && (
        <div className="feature-new">
          <input
            placeholder="Feature name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            autoFocus
          />
          <div className="feature-new-actions">
            <button onClick={handleCreate}>Add</button>
            <button onClick={() => { setShowNew(false); setNewName(""); }}>Cancel</button>
          </div>
        </div>
      )}
      <div className="features-list">
        {features.map((f) => (
          <button
            key={f.id}
            className={`feature-item ${selectedFeatureId === f.id ? "selected" : ""}`}
            onClick={() => onSelectFeature(selectedFeatureId === f.id ? null : f.id)}
          >
            <span className="feature-name">{f.name}</span>
            <span className="feature-count">{Number(f.session_count)}</span>
          </button>
        ))}
      </div>
      <button
        className={`feature-item untagged ${selectedFeatureId === "__untagged__" ? "selected" : ""}`}
        onClick={() => onSelectFeature(selectedFeatureId === "__untagged__" ? null : "__untagged__")}
      >
        <span className="feature-name">Untagged</span>
        <span className="feature-count">{untaggedCount}</span>
      </button>
    </aside>
  );
}
