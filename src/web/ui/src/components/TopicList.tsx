import { useState } from "react";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { Input } from "@/components/ui/input";
import { ChevronRight, Clock } from "lucide-react";
import type { TopicSummary } from "../types";

interface Props {
  topics: TopicSummary[];
  selectedTopicId: string | null;
  onSelectTopic: (id: string) => void;
}

export function TopicList({ topics, selectedTopicId, onSelectTopic }: Props) {
  const [search, setSearch] = useState("");

  const filtered = topics.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase())
  );

  const isSearching = search.length > 0;

  // Build tree
  const topicIds = new Set(topics.map((t) => t.id));
  const childrenOf = new Map<string | null, TopicSummary[]>();
  for (const t of filtered) {
    const parentId = t.parent_topic_id && topicIds.has(t.parent_topic_id) ? t.parent_topic_id : null;
    const list = childrenOf.get(parentId) || [];
    list.push(t);
    childrenOf.set(parentId, list);
  }

  const roots = (childrenOf.get(null) || []).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      {/* Search */}
      <SidebarGroup>
        <div className="px-2 pb-1">
          <Input
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 text-xs"
          />
        </div>
      </SidebarGroup>

      {/* File-explorer tree */}
      <SidebarGroup>
        <SidebarGroupLabel className="flex justify-between">
          <span>Knowledge Tree</span>
          <span className="text-xs text-muted-foreground font-normal">{topics.length}</span>
        </SidebarGroupLabel>
        <SidebarGroupContent>
          {filtered.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">
              {topics.length === 0 ? (
                <>No topics yet. Run <code className="bg-muted px-1 rounded text-[11px]">intent brain</code> to synthesize.</>
              ) : (
                "No matching topics."
              )}
            </div>
          )}

          <div className="font-mono text-[12px]">
            {isSearching
              ? filtered.map((t) => (
                  <SidebarTreeItem
                    key={t.id}
                    topic={t}
                    depth={0}
                    hasChildren={false}
                    expanded={false}
                    onToggle={() => {}}
                    isActive={selectedTopicId === t.id}
                    onClick={() => onSelectTopic(t.id)}
                  />
                ))
              : roots.map((t) => (
                  <SidebarTreeNode
                    key={t.id}
                    topic={t}
                    childrenOf={childrenOf}
                    depth={0}
                    selectedTopicId={selectedTopicId}
                    onSelectTopic={onSelectTopic}
                  />
                ))
            }
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}

// ── Sidebar tree node (recursive) ────────────────────────────────

function SidebarTreeNode({
  topic,
  childrenOf,
  depth,
  selectedTopicId,
  onSelectTopic,
}: {
  topic: TopicSummary;
  childrenOf: Map<string | null, TopicSummary[]>;
  depth: number;
  selectedTopicId: string | null;
  onSelectTopic: (id: string) => void;
}) {
  const children = (childrenOf.get(topic.id) || []).sort((a, b) => a.name.localeCompare(b.name));
  const [expanded, setExpanded] = useState(true);
  const hasChildren = children.length > 0;

  return (
    <div>
      <SidebarTreeItem
        topic={topic}
        depth={depth}
        hasChildren={hasChildren}
        expanded={expanded}
        onToggle={() => setExpanded(!expanded)}
        isActive={selectedTopicId === topic.id}
        onClick={() => onSelectTopic(topic.id)}
      />
      {expanded && hasChildren && (
        <div>
          {children.map((child) => (
            <SidebarTreeNode
              key={child.id}
              topic={child}
              childrenOf={childrenOf}
              depth={depth + 1}
              selectedTopicId={selectedTopicId}
              onSelectTopic={onSelectTopic}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SidebarTreeItem({
  topic,
  depth,
  hasChildren,
  expanded,
  onToggle,
  isActive,
  onClick,
}: {
  topic: TopicSummary;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  onToggle: () => void;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className={`flex items-center h-7 cursor-pointer group transition-colors ${
        isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
      }`}
      style={{ paddingLeft: depth * 12 + 8 }}
      onClick={onClick}
    >
      {hasChildren ? (
        <button
          className="shrink-0 w-4 h-4 flex items-center justify-center"
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
        >
          <ChevronRight className={`size-3 text-muted-foreground transition-transform duration-100 ${expanded ? "rotate-90" : ""}`} />
        </button>
      ) : (
        <span className="w-4 shrink-0" />
      )}
      <span className="ml-1 truncate text-[12px]">{topic.name}</span>
      <span className="ml-auto pr-2 text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity tabular-nums">
        {topic.insight_count}
      </span>
    </div>
  );
}
