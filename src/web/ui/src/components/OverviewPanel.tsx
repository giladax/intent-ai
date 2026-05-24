import { useState } from "react";
import type { TopicSummary, Session } from "../types";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BranchTimeline } from "./BranchTimeline";
import { ChevronRight } from "lucide-react";

interface Props {
  topics: TopicSummary[];
  sessions: Session[];
  repoId: string | null;
  onTopicClick: (id: string) => void;
}

export function OverviewPanel({ topics, sessions, repoId, onTopicClick }: Props) {
  if (topics.length === 0 && sessions.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        <div className="text-center space-y-2">
          <p>No execution memory yet.</p>
          <p>Run <code className="bg-muted px-1.5 py-0.5 rounded text-xs">intent digest</code> then <code className="bg-muted px-1.5 py-0.5 rounded text-xs">intent brain</code></p>
        </div>
      </div>
    );
  }

  const recentTopics = [...topics]
    .sort((a, b) => b.update_count - a.update_count)
    .slice(0, 5);

  const recentSessions = [...sessions]
    .sort((a, b) => {
      const da = a.started_at ? new Date(a.started_at).getTime() : 0;
      const db = b.started_at ? new Date(b.started_at).getTime() : 0;
      return db - da;
    })
    .slice(0, 5);

  const formatDate = (d: string | null) => {
    if (!d) return "";
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  // Build topic ID → name lookup
  const topicById = new Map(topics.map((t) => [t.id, t]));

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 space-y-8">
        {/* Stats */}
        <div className="flex gap-4">
          <Card className="flex-1 p-4 text-center">
            <div className="text-2xl font-semibold">{topics.length}</div>
            <div className="text-xs text-muted-foreground">Topics</div>
          </Card>
          <Card className="flex-1 p-4 text-center">
            <div className="text-2xl font-semibold">{sessions.length}</div>
            <div className="text-xs text-muted-foreground">Sessions</div>
          </Card>
        </div>

        {/* Branch timeline */}
        {repoId && (
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Branch Timeline</h3>
            <BranchTimeline repoId={repoId} />
          </div>
        )}

        {/* Knowledge Tree */}
        {topics.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Knowledge Tree</h3>
            <KnowledgeTree topics={topics} onTopicClick={onTopicClick} />
          </div>
        )}

        {/* Recent sessions */}
        {recentSessions.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent Sessions</h3>
            {recentSessions.map((s) => (
              <Card key={s.id} className="p-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground shrink-0">{formatDate(s.started_at)}</span>
                  <span className="text-sm truncate">{s.narrative_summary?.split(/[.!?\n]/)[0] || "No narrative"}</span>
                  {s.session_shape && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">{s.session_shape}</Badge>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Knowledge Tree ────────────────────────────────────────────────

function KnowledgeTree({ topics, onTopicClick }: { topics: TopicSummary[]; onTopicClick: (id: string) => void }) {
  // Build parent→children map
  const childrenOf = new Map<string | null, TopicSummary[]>();
  for (const t of topics) {
    const parentId = t.parent_topic_id || null;
    const list = childrenOf.get(parentId) || [];
    list.push(t);
    childrenOf.set(parentId, list);
  }

  // Roots are topics with no parent (or parent not in our set)
  const topicIds = new Set(topics.map((t) => t.id));
  const roots = topics.filter((t) => !t.parent_topic_id || !topicIds.has(t.parent_topic_id));

  // Sort by insight count descending
  roots.sort((a, b) => b.insight_count - a.insight_count);

  return (
    <div className="space-y-0.5">
      {roots.map((t) => (
        <TreeNode key={t.id} topic={t} childrenOf={childrenOf} depth={0} onTopicClick={onTopicClick} />
      ))}
    </div>
  );
}

function TreeNode({
  topic,
  childrenOf,
  depth,
  onTopicClick,
}: {
  topic: TopicSummary;
  childrenOf: Map<string | null, TopicSummary[]>;
  depth: number;
  onTopicClick: (id: string) => void;
}) {
  const children = childrenOf.get(topic.id) || [];
  const [expanded, setExpanded] = useState(depth === 0); // roots start expanded
  const hasChildren = children.length > 0;

  return (
    <div style={{ marginLeft: depth * 16 }}>
      <div
        className="flex items-start gap-1.5 py-2 px-2 rounded-lg hover:bg-muted/40 transition-colors cursor-pointer group"
        onClick={() => onTopicClick(topic.id)}
      >
        {hasChildren ? (
          <button
            className="mt-0.5 shrink-0"
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          >
            <ChevronRight className={`size-4 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} />
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium group-hover:text-primary transition-colors">
            {topic.name}
          </span>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
            {topic.summary.slice(0, 150)}
          </p>
        </div>

        <div className="text-[10px] text-muted-foreground shrink-0 mt-0.5 text-right">
          <div>{topic.insight_count} insights</div>
          {topic.session_count > 0 && <div>{topic.session_count} sessions</div>}
        </div>
      </div>

      {expanded && hasChildren && (
        <div className="space-y-0.5">
          {children
            .sort((a, b) => b.insight_count - a.insight_count)
            .map((child) => (
              <TreeNode key={child.id} topic={child} childrenOf={childrenOf} depth={depth + 1} onTopicClick={onTopicClick} />
            ))}
        </div>
      )}
    </div>
  );
}
