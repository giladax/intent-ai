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
  // Sort sessions by date descending, then group by date
  const sorted = [...sessions].sort((a, b) => {
    const da = a.started_at ? new Date(a.started_at).getTime() : 0;
    const db = b.started_at ? new Date(b.started_at).getTime() : 0;
    return db - da;
  });

  const groups: [string, Session[]][] = [];
  const groupMap = new Map<string, number>();
  for (const s of sorted) {
    const date = s.started_at
      ? new Date(s.started_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : "Unknown";
    const idx = groupMap.get(date);
    if (idx !== undefined) {
      groups[idx][1].push(s);
    } else {
      groupMap.set(date, groups.length);
      groups.push([date, [s]]);
    }
  }

  const getTitle = (s: Session) => {
    if (!s.narrative_summary) return "No narrative";
    const first = s.narrative_summary.split(/[.!?\n]/)[0];
    return first.length > 60 ? first.slice(0, 57) + "..." : first;
  };

  return (
    <>
      <div className="sidebar-header">
        <span className="sidebar-title">Sessions</span>
        <span className="sidebar-count">{sessions.length}</span>
      </div>
      <div className="sidebar-list">
        {groups.map(([date, dateSessions]) => (
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
                {s.topics && s.topics.length > 0 && (
                  <div className="sidebar-item-topics">
                    {s.topics.map((t) => (
                      <span
                        key={t.topicId}
                        className="topic-badge"
                        onClick={(e) => { e.stopPropagation(); onTopicClick(t.topicId); }}
                      >
                        {t.topicName}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
