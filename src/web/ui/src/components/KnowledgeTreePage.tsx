import { useState } from "react";
import type { TopicSummary } from "../types";
import { Button } from "@/components/ui/button";
import { ChevronRight, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface Props {
  topics: TopicSummary[];
  sessions: { length: number };
  repoId: string | null;
  onTopicClick: (id: string) => void;
  onSync: () => void;
  undigestedCount: number;
}

export function KnowledgeTreePage({ topics, sessions, onTopicClick, onSync, undigestedCount }: Props) {
  if (topics.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        <div className="text-center space-y-3">
          <p>No knowledge yet.</p>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={onSync}>
            <RefreshCw className="size-3" /> Sync Brain to get started
          </Button>
        </div>
      </div>
    );
  }

  const topicIds = new Set(topics.map((t) => t.id));
  const childrenOf = new Map<string | null, TopicSummary[]>();
  for (const t of topics) {
    const pid = t.parent_topic_id && topicIds.has(t.parent_topic_id) ? t.parent_topic_id : null;
    const list = childrenOf.get(pid) || [];
    list.push(t);
    childrenOf.set(pid, list);
  }
  const roots = (childrenOf.get(null) || []).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Knowledge Tree</h2>
          <p className="text-xs text-muted-foreground">{topics.length} specs · {sessions.length} sessions</p>
        </div>
        {undigestedCount > 0 && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={onSync}>
            <RefreshCw className="size-3" /> Sync
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">+{undigestedCount}</Badge>
          </Button>
        )}
      </div>

      <div>
        {roots.map((t) => (
          <TreeNode key={t.id} topic={t} childrenOf={childrenOf} depth={0} onTopicClick={onTopicClick} />
        ))}
      </div>
    </div>
  );
}

function TreeNode({ topic, childrenOf, depth, onTopicClick }: {
  topic: TopicSummary;
  childrenOf: Map<string | null, TopicSummary[]>;
  depth: number;
  onTopicClick: (id: string) => void;
}) {
  const children = (childrenOf.get(topic.id) || []).sort((a, b) => a.name.localeCompare(b.name));
  const [expanded, setExpanded] = useState(true);
  const hasChildren = children.length > 0;
  const isRoot = depth === 0;

  return (
    <div>
      <div
        className={`flex items-center gap-1 cursor-pointer group rounded transition-colors hover:bg-accent/50 ${isRoot ? "h-9" : "h-8"}`}
        style={{ paddingLeft: depth * 20 + 8 }}
        onClick={() => onTopicClick(topic.id)}
      >
        {hasChildren ? (
          <button
            className="shrink-0 w-5 h-5 flex items-center justify-center -ml-1"
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          >
            <ChevronRight className={`size-3.5 text-muted-foreground transition-transform duration-100 ${expanded ? "rotate-90" : ""}`} />
          </button>
        ) : (
          <span className="w-5 shrink-0 -ml-1" />
        )}
        <span className={`truncate ${isRoot ? "font-medium text-sm" : "text-sm text-foreground/80"}`}>
          {topic.name}
        </span>
        <span className="ml-auto pr-2 text-[10px] text-muted-foreground tabular-nums opacity-0 group-hover:opacity-100 transition-opacity">
          {topic.insight_count}
        </span>
      </div>

      {expanded && hasChildren && children.map((child) => (
        <TreeNode key={child.id} topic={child} childrenOf={childrenOf} depth={depth + 1} onTopicClick={onTopicClick} />
      ))}
    </div>
  );
}
