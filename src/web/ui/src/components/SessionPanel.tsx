import { useState, useEffect } from "react";
import { fetchFeatureDetail, tagSession, untagSession } from "../api";
import type { Session, FeatureDetail } from "../types";

interface Props {
  featureId: string | null;
  sessions: Session[];
  selectedSessionId: string | null;
  onSelectSession: (id: string | null) => void;
  onTagChanged: () => void;
}

const SHAPE_COLORS: Record<string, string> = {
  narrative: "var(--narrative)",
  debugging: "var(--debugging)",
  exploratory: "var(--exploratory)",
  janitorial: "var(--janitorial)",
  review: "var(--review)",
};

const ROLES = ["origin", "development", "turning_point", "resolution"];

export function SessionPanel({ featureId, sessions, selectedSessionId, onSelectSession, onTagChanged }: Props) {
  const [featureDetail, setFeatureDetail] = useState<FeatureDetail | null>(null);
  const [tagModal, setTagModal] = useState<{ sessionId: string } | null>(null);
  const [tagRole, setTagRole] = useState("development");

  useEffect(() => {
    if (featureId && featureId !== "__untagged__") {
      fetchFeatureDetail(featureId).then(setFeatureDetail);
    } else {
      setFeatureDetail(null);
    }
  }, [featureId]);

  const handleTag = async () => {
    if (!tagModal || !featureId || featureId === "__untagged__") return;
    await tagSession(featureId, tagModal.sessionId, tagRole);
    onTagChanged();
    if (featureId !== "__untagged__") {
      fetchFeatureDetail(featureId).then(setFeatureDetail);
    }
    setTagModal(null);
  };

  const handleUntag = async (sessionId: string) => {
    if (!featureId || featureId === "__untagged__") return;
    await untagSession(featureId, sessionId);
    onTagChanged();
    fetchFeatureDetail(featureId).then(setFeatureDetail);
  };

  // Determine which sessions to show
  let displaySessions: Array<{
    id: string;
    shape: string | null;
    startedAt: string | null;
    summary: string | null;
    momentCount: number;
    role?: string;
  }>;

  if (featureId === "__untagged__") {
    const tagged = new Set<string>();
    for (const s of sessions) {
      if (s.features && s.features.length > 0) tagged.add(s.id);
    }
    displaySessions = sessions
      .filter((s) => !tagged.has(s.id))
      .map((s) => ({
        id: s.id,
        shape: s.session_shape,
        startedAt: s.started_at,
        summary: s.narrative_summary,
        momentCount: Number(s.moment_count),
      }));
  } else if (featureDetail) {
    displaySessions = featureDetail.sessions.map((s) => ({
      id: s.id,
      shape: s.sessionShape,
      startedAt: s.startedAt,
      summary: s.narrativeSummary,
      momentCount: s.momentCount,
      role: s.role,
    }));
  } else {
    displaySessions = sessions.map((s) => ({
      id: s.id,
      shape: s.session_shape,
      startedAt: s.started_at,
      summary: s.narrative_summary,
      momentCount: Number(s.moment_count),
    }));
  }

  const formatDate = (d: string | null) => {
    if (!d) return "Unknown date";
    return new Date(d).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
  };

  const getTitle = (summary: string | null) => {
    if (!summary) return "No narrative";
    const first = summary.split(/[.!?\n]/)[0];
    return first.length > 80 ? first.slice(0, 77) + "..." : first;
  };

  return (
    <main className="sessions">
      {/* Feature header + story */}
      {featureDetail && (
        <div className="feature-header">
          <h2>{featureDetail.feature.name}</h2>
          {featureDetail.feature.description && (
            <p className="feature-desc">{featureDetail.feature.description}</p>
          )}
          {featureDetail.story && (
            <details className="feature-story">
              <summary>Feature Story</summary>
              <div className="story-content">
                {featureDetail.story.split("\n\n---\n\n").map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {featureId === "__untagged__" && (
        <div className="feature-header">
          <h2>Untagged Sessions</h2>
          <p className="feature-desc">Sessions not assigned to any feature</p>
        </div>
      )}

      {!featureId && (
        <div className="feature-header">
          <h2>All Sessions</h2>
          <p className="feature-desc">Select a feature to filter, or browse all sessions</p>
        </div>
      )}

      {/* Session cards */}
      <div className="session-cards">
        {displaySessions.map((s) => (
          <div
            key={s.id}
            className={`session-card ${selectedSessionId === s.id ? "selected" : ""}`}
            onClick={() => onSelectSession(selectedSessionId === s.id ? null : s.id)}
          >
            <div className="session-card-header">
              <span className="session-title">{getTitle(s.summary)}</span>
              <div className="session-badges">
                {s.shape && (
                  <span
                    className="badge shape-badge"
                    style={{ backgroundColor: SHAPE_COLORS[s.shape] ?? "var(--text-secondary)" }}
                  >
                    {s.shape}
                  </span>
                )}
                {s.role && (
                  <span className="badge role-badge">{s.role.replace("_", " ")}</span>
                )}
              </div>
            </div>
            <div className="session-card-meta">
              <span>{formatDate(s.startedAt)}</span>
              <span>{s.momentCount} moments</span>
              {featureId && featureId !== "__untagged__" && (
                <button
                  className="btn-tiny"
                  onClick={(e) => { e.stopPropagation(); handleUntag(s.id); }}
                >
                  untag
                </button>
              )}
            </div>
          </div>
        ))}
        {displaySessions.length === 0 && (
          <div className="empty-state">No sessions found</div>
        )}
      </div>

      {/* Tag modal */}
      {featureId && featureId !== "__untagged__" && (
        <div className="tag-section">
          <button
            className="btn-small"
            onClick={() => {
              // Show modal to pick a session to tag
              const untagged = sessions.filter(
                (s) => !featureDetail?.sessions.some((fs) => fs.id === s.id)
              );
              if (untagged.length > 0) {
                setTagModal({ sessionId: untagged[0].id });
              }
            }}
          >
            + Tag Session
          </button>
        </div>
      )}

      {tagModal && (
        <div className="modal-overlay" onClick={() => setTagModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Tag Session to Feature</h3>
            <label>
              Session:
              <select
                value={tagModal.sessionId}
                onChange={(e) => setTagModal({ sessionId: e.target.value })}
              >
                {sessions
                  .filter((s) => !featureDetail?.sessions.some((fs) => fs.id === s.id))
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {getTitle(s.narrative_summary)} ({formatDate(s.started_at)})
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Role:
              <select value={tagRole} onChange={(e) => setTagRole(e.target.value)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>{r.replace("_", " ")}</option>
                ))}
              </select>
            </label>
            <div className="modal-actions">
              <button onClick={handleTag}>Tag</button>
              <button onClick={() => setTagModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
