import type { TopicSummary } from "../types";

interface Props {
  topics: TopicSummary[];
  selectedTopicId: string | null;
  onSelectTopic: (id: string) => void;
}

export function TopicList({ topics, selectedTopicId, onSelectTopic }: Props) {
  return (
    <>
      <div className="sidebar-header">
        <span className="sidebar-title">Topics</span>
        <span className="sidebar-count">{topics.length}</span>
      </div>
      <div className="sidebar-list">
        {topics.length === 0 && (
          <div className="empty-state">
            No topics yet. Run <code>intent brain</code> to synthesize.
          </div>
        )}
        {topics.map((t) => (
          <button
            key={t.id}
            className={`sidebar-item ${selectedTopicId === t.id ? "selected" : ""}`}
            onClick={() => onSelectTopic(t.id)}
          >
            <div className="sidebar-item-name">{t.name}</div>
            <div className="sidebar-item-meta">
              {t.insight_count} insights · {t.session_count} sessions
            </div>
          </button>
        ))}
      </div>
    </>
  );
}
