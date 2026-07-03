import { useState } from "react";
import type { TopicSummary } from "../types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronRight, RefreshCw, Folder, FolderOpen, FileText } from "lucide-react";

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

  // parent_topic_id retired (PRD v0.3) — topics render as a flat sorted list
  const childrenOf = new Map<string | null, TopicSummary[]>();
  childrenOf.set(null, [...topics]);
  const roots = (childrenOf.get(null) || []).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <TooltipProvider delayDuration={400}>
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

        <Card className="p-2">
          {roots.map((t) => (
            <TreeNode key={t.id} topic={t} childrenOf={childrenOf} depth={0} onTopicClick={onTopicClick} />
          ))}
        </Card>
      </div>
    </TooltipProvider>
  );
}

function TreeNode({ topic, childrenOf, depth, onTopicClick }: {
  topic: TopicSummary;
  childrenOf: Map<string | null, TopicSummary[]>;
  depth: number;
  onTopicClick: (id: string) => void;
}) {
  const children = (childrenOf.get(topic.id) || []).sort((a, b) => a.name.localeCompare(b.name));
  const [open, setOpen] = useState(true);
  const hasChildren = children.length > 0;
  const isRoot = depth === 0;

  if (!hasChildren) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors text-left"
            style={{ paddingLeft: depth * 20 + 8 }}
            onClick={() => onTopicClick(topic.id)}
          >
            <FileText className="size-4 text-muted-foreground shrink-0" />
            <span className="truncate">{topic.name}</span>
            <span className="ml-auto text-[10px] text-muted-foreground tabular-nums shrink-0">{topic.insight_count}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-xs">
          <p className="text-xs">{topic.summary.slice(0, 200)}{topic.summary.length > 200 ? "..." : ""}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <CollapsibleTrigger asChild>
            <button
              className={`flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors text-left ${isRoot ? "font-medium" : ""}`}
              style={{ paddingLeft: depth * 20 + 8 }}
              onClick={(e) => {
                // Click name → navigate, click chevron → toggle
                if ((e.target as HTMLElement).closest("[data-chevron]")) {
                  e.preventDefault();
                  setOpen(!open);
                } else {
                  onTopicClick(topic.id);
                }
              }}
            >
              <div data-chevron className="shrink-0">
                {open
                  ? <FolderOpen className="size-4 text-muted-foreground" />
                  : <Folder className="size-4 text-muted-foreground" />
                }
              </div>
              <span className="truncate">{topic.name}</span>
              <span className="ml-auto text-[10px] text-muted-foreground tabular-nums shrink-0">{topic.insight_count}</span>
              <ChevronRight
                data-chevron
                className={`size-3.5 text-muted-foreground transition-transform duration-200 shrink-0 ${open ? "rotate-90" : ""}`}
              />
            </button>
          </CollapsibleTrigger>
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-xs">
          <p className="text-xs">{topic.summary.slice(0, 200)}{topic.summary.length > 200 ? "..." : ""}</p>
        </TooltipContent>
      </Tooltip>
      <CollapsibleContent>
        <div className="border-l border-border ml-[22px]" style={{ marginLeft: depth * 20 + 22 }}>
          {children.map((child) => (
            <TreeNode key={child.id} topic={child} childrenOf={childrenOf} depth={depth + 1} onTopicClick={onTopicClick} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
