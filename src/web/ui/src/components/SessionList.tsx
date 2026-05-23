import type { Session, TopicSummary } from "../types";

interface Props {
  sessions: Session[];
  selectedSessionId: string | null;
  onSelectSession: (id: string) => void;
  topics: TopicSummary[];
  onTopicClick: (topicId: string) => void;
}

export function SessionList({
  sessions,
  selectedSessionId,
  onSelectSession,
  topics,
  onTopicClick,
}: Props) {
  // Group by date
  const groups = new Map<string, Session[]>();
  for (const s of sessions) {
    const date = s.started_at
      ? new Date(s.started_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : "Unknown";
    const list = groups.get(date) || [];
    list.push(s);
    groups.set(date, list);
  }

  const getTitle = (s: Session) => {
    if (!s.narrative_summary) return "No narrative";
    const first = s.narrative_summary.split(/[.!?\n]/)[0];
    return first.length > 60 ? first.slice(0, 57) + "..." : first;
  };

  // TODO: once topic_sessions is queryable per session, show real topic badges
  // For now, topics are not linked per-session in the API

  return (
    <>
      <div className="sidebar-header">
        <span className="sidebar-title">Sessions</span>
        <span className="sidebar-count">{sessions.length}</span>
      </div>
      <div className="sidebar-list">
        {[...groups.entries()].map(([date, dateSessions]) => (
          <div key={date}>
            <div className="sidebar-date-group">{date}</div>
            {dateSessions.map((s) => (
              <button
                key={s.id}
                className={`sidebar-item ${selectedSessionId === s.id ? "selected" : ""}`}
                onClick={() => onSelectSession(s.id)}
              >
                <div className="sidebar-item-name">{getTitle(s)}</div>
                <div className="sidebar-item-meta">
                  <span className={`shape-label shape-${s.session_shape}`}>
                    {s.session_shape}
                  </span>
                  <span>{s.moment_count} moments</span>
                </div>
              </button>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
