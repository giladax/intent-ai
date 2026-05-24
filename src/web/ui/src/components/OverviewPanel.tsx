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

// ── File-explorer style Knowledge Tree ────────────────────────────

function KnowledgeTree({ topics, onTopicClick }: { topics: TopicSummary[]; onTopicClick: (id: string) => void }) {
  const childrenOf = new Map<string | null, TopicSummary[]>();
  for (const t of topics) {
    const list = childrenOf.get(t.parent_topic_id || null) || [];
    list.push(t);
    childrenOf.set(t.parent_topic_id || null, list);
  }

  const topicIds = new Set(topics.map((t) => t.id));
  const roots = topics
    .filter((t) => !t.parent_topic_id || !topicIds.has(t.parent_topic_id))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="font-mono text-[13px]">
      {roots.map((t) => (
        <FileTreeNode key={t.id} topic={t} childrenOf={childrenOf} depth={0} onTopicClick={onTopicClick} />
      ))}
    </div>
  );
}

function FileTreeNode({
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
  const children = (childrenOf.get(topic.id) || []).sort((a, b) => a.name.localeCompare(b.name));
  const [expanded, setExpanded] = useState(true);
  const hasChildren = children.length > 0;
  const [hovered, setHovered] = useState(false);

  return (
    <div>
      <div
        className="flex items-center h-7 hover:bg-accent/50 cursor-pointer group relative"
        style={{ paddingLeft: depth * 16 + 4 }}
        onClick={() => onTopicClick(topic.id)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {hasChildren ? (
          <button
            className="shrink-0 w-4 h-4 flex items-center justify-center"
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          >
            <ChevronRight className={`size-3 text-muted-foreground transition-transform duration-100 ${expanded ? "rotate-90" : ""}`} />
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <span className="ml-1 truncate">{topic.name}</span>
        <span className="ml-auto pr-3 text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
          {topic.insight_count}
        </span>

        {/* Hover card */}
        {hovered && (
          <div className="absolute left-full top-0 ml-2 z-50 w-72 p-3 rounded-lg border bg-popover text-popover-foreground shadow-lg text-xs font-sans animate-in fade-in duration-100"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            <div className="font-semibold text-sm mb-1">{topic.name}</div>
            <p className="text-muted-foreground leading-relaxed">{topic.summary.slice(0, 200)}{topic.summary.length > 200 ? "..." : ""}</p>
            <div className="mt-2 flex gap-3 text-[10px] text-muted-foreground">
              <span>{topic.insight_count} insights</span>
              <span>{topic.session_count} sessions</span>
            </div>
          </div>
        )}
      </div>

      {expanded && hasChildren && (
        <div>
          {children.map((child) => (
            <FileTreeNode key={child.id} topic={child} childrenOf={childrenOf} depth={depth + 1} onTopicClick={onTopicClick} />
          ))}
        </div>
      )}
    </div>
  );
}
