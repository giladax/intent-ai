import { useState, useEffect } from "react";
import { fetchSessionDetail } from "../api";
import type { SessionDetail } from "../types";

interface Props {
  sessionId: string | null;
}

const SHAPE_COLORS: Record<string, string> = {
  narrative: "var(--narrative)",
  debugging: "var(--debugging)",
  exploratory: "var(--exploratory)",
  janitorial: "var(--janitorial)",
  review: "var(--review)",
};

export function SessionPanel({ sessionId }: Props) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setDetail(null);
      return;
    }
    fetchSessionDetail(sessionId).then(setDetail).catch(() => setDetail(null));
  }, [sessionId]);

  if (!sessionId) {
    return (
      <div className="detail-empty">
        Select a session to explore your execution memory
      </div>
    );
  }

  if (!detail) {
    return <div className="detail-empty">Loading...</div>;
  }

  const { narrative, moments, transitions, outcomes } = detail;

  return (
    <div className="session-detail">
      {/* Narrative */}
      {narrative && (
        <>
          <div className="session-detail-header">
            <span
              className="shape-badge-lg"
              style={{ background: SHAPE_COLORS[narrative.sessionShape] }}
            >
              {narrative.sessionShape}
            </span>
            <span className="session-detail-stat">{moments.length} moments</span>
            <span className="session-detail-stat">{transitions.length} transitions</span>
          </div>

          <p className="session-summary">{narrative.summary}</p>

          {/* Arcs */}
          {narrative.arcs.length > 0 && (
            <div className="session-section">
              <h3 className="session-section-title">Arcs</h3>
              {narrative.arcs.map((arc, i) => (
                <div key={i} className="arc-item">
                  <span className="arc-title">{arc.title}</span>
                  <span className={`arc-resolution arc-${arc.resolution}`}>{arc.resolution}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Moments */}
      {moments.length > 0 && (
        <div className="session-section">
          <h3 className="session-section-title">Moments</h3>
          {moments.map((m, i) => (
            <div key={i} className="moment-item">
              <div className="moment-header">
                <span className={`moment-type moment-type-${m.type}`}>{m.type}</span>
                <span className="moment-agency">{m.agency}</span>
              </div>
              <div className="moment-statement">{m.statement}</div>
            </div>
          ))}
        </div>
      )}

      {/* Outcomes */}
      {outcomes.length > 0 && (
        <div className="session-section">
          <h3 className="session-section-title">Outcomes</h3>
          {outcomes.map((o, i) => (
            <div key={i} className="outcome-item">{o.statement}</div>
          ))}
        </div>
      )}

      {/* Abandoned */}
      {narrative && narrative.abandonedDirections.length > 0 && (
        <div className="session-section">
          <h3 className="session-section-title">Abandoned</h3>
          {narrative.abandonedDirections.map((d, i) => (
            <div key={i} className="abandoned-item">{d}</div>
          ))}
        </div>
      )}
    </div>
  );
}
