import { useState, useEffect } from "react";
import { fetchTopicDetail } from "../api";
import type { TopicDetail as TopicDetailType } from "../types";

interface Props {
  topicId: string | null;
  onSessionClick: (sessionId: string) => void;
  onTopicClick: (topicId: string) => void;
}

const CATEGORY_ORDER = ["structure", "constraint", "decision", "behavior", "risk", "interface"];

const CATEGORY_COLORS: Record<string, string> = {
  structure: "#3A6B52",
  decision: "#5B7B9E",
  constraint: "#C08B5C",
  behavior: "#9B6B9E",
  risk: "#C05C5C",
  interface: "#7B8FA1",
};

export function TopicDetail({ topicId, onSessionClick, onTopicClick }: Props) {
  const [detail, setDetail] = useState<TopicDetailType | null>(null);

  useEffect(() => {
    if (!topicId) {
      setDetail(null);
      return;
    }
    fetchTopicDetail(topicId).then(setDetail).catch(() => setDetail(null));
  }, [topicId]);

  if (!topicId) {
    return (
      <div className="detail-empty">
        Select a topic to explore its insights
      </div>
    );
  }

  if (!detail) {
    return <div className="detail-empty">Loading...</div>;
  }

  // Group insights by category
  const byCategory = new Map<string, typeof detail.insights>();
  for (const i of detail.insights) {
    const list = byCategory.get(i.category) || [];
    list.push(i);
    byCategory.set(i.category, list);
  }

  const formatDate = (d: string | null) => {
    if (!d) return "";
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const truncate = (s: string, max: number) =>
    s.length > max ? s.slice(0, max - 3) + "..." : s;

  return (
    <div className="topic-detail">
      <h2 className="topic-name">{detail.topic.name}</h2>
      <p className="topic-summary">{detail.topic.summary}</p>

      {/* Insights by category */}
      <div className="topic-insights">
        {CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((cat) => (
          <div key={cat} className="insight-group">
            <div className="insight-category">
              <span
                className="category-dot"
                style={{ background: CATEGORY_COLORS[cat] }}
              />
              {cat}
            </div>
            {byCategory.get(cat)!.map((insight, i) => (
              <div key={i} className="insight-item">
                {insight.statement}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Files */}
      {detail.files.length > 0 && (
        <div className="topic-section">
          <h3 className="topic-section-title">Files</h3>
          {detail.files.map((f, i) => (
            <div key={i} className="topic-file">
              <code>{f.file_path}</code>
              {f.role && <span className="file-role">{f.role}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Your sessions */}
      {detail.sessions.length > 0 && (
        <div className="topic-section">
          <h3 className="topic-section-title">Your Sessions</h3>
          {detail.sessions.map((s) => (
            <button
              key={s.session_id}
              className="topic-session"
              onClick={() => onSessionClick(s.session_id)}
            >
              <span className="topic-session-date">{formatDate(s.started_at)}</span>
              <span className="topic-session-summary">
                {truncate(s.summary || s.session_shape || "Session", 80)}
              </span>
              <span className="topic-session-moments">{s.moment_count} moments</span>
            </button>
          ))}
        </div>
      )}

      {/* Related topics */}
      {detail.relatedTopics.length > 0 && (
        <div className="topic-section">
          <h3 className="topic-section-title">Related</h3>
          <div className="topic-related">
            {detail.relatedTopics.map((r) => (
              <button
                key={r.id}
                className="related-topic-btn"
                onClick={() => onTopicClick(r.id)}
              >
                {r.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
