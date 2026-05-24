import { useState, useEffect } from "react";
import type { TopicSummary, Session } from "../types";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { BranchTimeline } from "./BranchTimeline";
import { ChevronRight, CircleDot, RefreshCw, Folder, FolderOpen, FileText } from "lucide-react";

interface Props {
  topics: TopicSummary[];
  sessions: Session[];
  repoId: string | null;
  onTopicClick: (id: string) => void;
  onSyncBrain?: () => void;
}

export function OverviewPanel({ topics, sessions, repoId, onTopicClick, onSyncBrain }: Props) {
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

  // Fetch undigested count
  const [undigestedCount, setUndigestedCount] = useState<number | null>(null);
  useEffect(() => {
    if (!repoId) return;
    fetch("/api/brain/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoId }),
    })
      .then((r) => r.json())
      .then((data) => setUndigestedCount(data.undigestedCount ?? 0))
      .catch(() => {});
  }, [repoId]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 space-y-8">
        {/* Stats */}
        <div className="flex gap-3">
          <Card className="flex-1 p-4 text-center">
            <div className="text-2xl font-semibold">{topics.length}</div>
            <div className="text-xs text-muted-foreground">Topics</div>
          </Card>
          <Card className="flex-1 p-4 text-center">
            <div className="text-2xl font-semibold">{sessions.length}</div>
            <div className="text-xs text-muted-foreground">Digested</div>
          </Card>
          <Card className={`flex-1 p-4 text-center ${undigestedCount ? "border-amber-300 dark:border-amber-700" : ""}`}>
            <div className={`text-2xl font-semibold ${undigestedCount ? "text-amber-600 dark:text-amber-400" : ""}`}>
              {undigestedCount ?? "—"}
            </div>
            <div className="text-xs text-muted-foreground">Undigested</div>
          </Card>
        </div>

        {/* Sync CTA when undigested sessions exist */}
        {undigestedCount != null && undigestedCount > 0 && onSyncBrain && (
          <Card className="p-4 border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm">
                <span className="font-medium">{undigestedCount} new session{undigestedCount !== 1 ? "s" : ""}</span>
                <span className="text-muted-foreground"> waiting to be digested</span>
              </div>
              <Button size="sm" variant="outline" className="gap-1.5 shrink-0" onClick={onSyncBrain}>
                <RefreshCw className="size-3" />
                Sync Brain
              </Button>
            </div>
          </Card>
        )}

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
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Latest Sessions</h3>
            <div className="space-y-1">
              {recentSessions.map((s) => (
                <div key={s.id} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/40 text-sm">
                  <CircleDot className="size-3 shrink-0 text-emerald-500" />
                  <span className="text-xs text-muted-foreground shrink-0 w-14">{formatDate(s.started_at)}</span>
                  <span className="truncate flex-1">{s.narrative_summary?.split(/[.!?\n]/)[0] || "No narrative"}</span>
                  {s.session_shape && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">{s.session_shape}</Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Knowledge Tree (using Collapsible) ───────────────────────────

function KnowledgeTree({ topics, onTopicClick }: { topics: TopicSummary[]; onTopicClick: (id: string) => void }) {
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
    <Card className="p-2">
      {roots.map((t) => (
        <MiniTreeNode key={t.id} topic={t} childrenOf={childrenOf} depth={0} onTopicClick={onTopicClick} />
      ))}
    </Card>
  );
}

function MiniTreeNode({ topic, childrenOf, depth, onTopicClick }: {
  topic: TopicSummary;
  childrenOf: Map<string | null, TopicSummary[]>;
  depth: number;
  onTopicClick: (id: string) => void;
}) {
  const children = (childrenOf.get(topic.id) || []).sort((a, b) => a.name.localeCompare(b.name));
  const [open, setOpen] = useState(true);
  const hasChildren = children.length > 0;

  if (!hasChildren) {
    return (
      <button
        className="flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors text-left"
        style={{ paddingLeft: depth * 20 + 8 }}
        onClick={() => onTopicClick(topic.id)}
      >
        <FileText className="size-4 text-muted-foreground shrink-0" />
        <span className="truncate">{topic.name}</span>
        <span className="ml-auto text-[10px] text-muted-foreground tabular-nums shrink-0">{topic.insight_count}</span>
      </button>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          className={`flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors text-left ${depth === 0 ? "font-medium" : ""}`}
          style={{ paddingLeft: depth * 20 + 8 }}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("[data-chevron]")) {
              setOpen(!open);
            } else {
              onTopicClick(topic.id);
            }
          }}
        >
          {open ? <FolderOpen className="size-4 text-muted-foreground shrink-0" /> : <Folder className="size-4 text-muted-foreground shrink-0" />}
          <span className="truncate">{topic.name}</span>
          <span className="ml-auto text-[10px] text-muted-foreground tabular-nums shrink-0">{topic.insight_count}</span>
          <ChevronRight data-chevron className={`size-3.5 text-muted-foreground transition-transform duration-200 shrink-0 ${open ? "rotate-90" : ""}`} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-l border-border" style={{ marginLeft: depth * 20 + 22 }}>
          {children.map((child) => (
            <MiniTreeNode key={child.id} topic={child} childrenOf={childrenOf} depth={depth + 1} onTopicClick={onTopicClick} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
