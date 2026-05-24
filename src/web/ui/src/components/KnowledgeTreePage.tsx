import { useState } from "react";
import type { TopicSummary, Session } from "../types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, RefreshCw } from "lucide-react";

interface Props {
  topics: TopicSummary[];
  sessions: Session[];
  repoId: string | null;
  onTopicClick: (id: string) => void;
  onSync: () => void;
  undigestedCount: number;
}

export function KnowledgeTreePage({ topics, sessions, repoId, onTopicClick, onSync, undigestedCount }: Props) {
  if (topics.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        <div className="text-center space-y-3">
          <p>No knowledge yet.</p>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={onSync}>
            <RefreshCw className="size-3" />
            Sync Brain to get started
          </Button>
        </div>
      </div>
    );
  }

  // Build tree
  const topicIds = new Set(topics.map((t) => t.id));
  const childrenOf = new Map<string | null, TopicSummary[]>();
  for (const t of topics) {
    const parentId = t.parent_topic_id && topicIds.has(t.parent_topic_id) ? t.parent_topic_id : null;
    const list = childrenOf.get(parentId) || [];
    list.push(t);
    childrenOf.set(parentId, list);
  }
  const roots = (childrenOf.get(null) || []).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      {/* Header with stats */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Knowledge Tree</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {topics.length} specs · {sessions.length} sessions digested
          </p>
        </div>
        {undigestedCount > 0 && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={onSync}>
            <RefreshCw className="size-3" />
            Sync
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
              +{undigestedCount}
            </Badge>
          </Button>
        )}
      </div>

      {/* Tree */}
      <div className="font-mono text-[13px]">
        {roots.map((t) => (
          <TreeNode key={t.id} topic={t} childrenOf={childrenOf} depth={0} onTopicClick={onTopicClick} />
        ))}
      </div>
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
  const children = (childrenOf.get(topic.id) || []).sort((a, b) => a.name.localeCompare(b.name));
  const [expanded, setExpanded] = useState(true);
  const [hovered, setHovered] = useState(false);
  const hasChildren = children.length > 0;

  return (
    <div>
      <div
        className="flex items-center h-8 hover:bg-accent/50 cursor-pointer group relative"
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
        <span className="ml-auto pr-3 text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity tabular-nums">
          {topic.insight_count} insights
        </span>

        {hovered && (
          <div
            className="absolute left-full top-0 ml-2 z-50 w-72 p-3 rounded-lg border bg-popover text-popover-foreground shadow-lg text-xs font-sans animate-in fade-in duration-100"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            <div className="font-semibold text-sm mb-1">{topic.name}</div>
            <p className="text-muted-foreground leading-relaxed">
              {topic.summary.slice(0, 200)}{topic.summary.length > 200 ? "..." : ""}
            </p>
            <div className="mt-2 flex gap-3 text-[10px] text-muted-foreground">
              <span>{topic.insight_count} insights</span>
              <span>{topic.session_count} sessions</span>
            </div>
          </div>
        )}
      </div>

      {expanded && hasChildren && children.map((child) => (
        <TreeNode key={child.id} topic={child} childrenOf={childrenOf} depth={depth + 1} onTopicClick={onTopicClick} />
      ))}
    </div>
  );
}
