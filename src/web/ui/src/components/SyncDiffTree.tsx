import { useState } from "react";
import type { TopicSummary, BrainSyncProposal, BrainSyncChange } from "../types";
import { ChevronRight, Plus, Pencil, Merge, Trash2 } from "lucide-react";

interface Props {
  topics: TopicSummary[];
  proposal: BrainSyncProposal;
  onTopicClick?: (topicId: string) => void;
}

// Change annotations
const CHANGE_COLORS = {
  add: { text: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/20" },
  update: { text: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-950/20" },
  merge: { text: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/20" },
  delete: { text: "text-red-500 dark:text-red-400 line-through", bg: "bg-red-50 dark:bg-red-950/20" },
} as const;

const CHANGE_ICONS = { add: Plus, update: Pencil, merge: Merge, delete: Trash2 };

interface TreeNode {
  id: string | null;
  name: string;
  summary: string;
  parentName: string | null;
  children: TreeNode[];
  insightCount: number;
  change: (BrainSyncChange & { mergedInto?: string }) | null;
}

export function SyncDiffTree({ topics, proposal, onTopicClick }: Props) {
  // Build change lookup
  const changeByName = new Map<string, BrainSyncChange>();
  for (const c of proposal.changes) {
    const name = c.type === "merge" ? c.into : c.spec;
    if (name) changeByName.set(name, c);
  }

  // Track specs being merged away (they show as deleted with "→ merged into X")
  const mergedAway = new Map<string, string>(); // old name → merged-into name
  for (const c of proposal.changes) {
    if (c.type === "merge" && c.from) {
      for (const src of c.from) {
        mergedAway.set(src, c.into ?? "");
      }
    }
  }

  // Spec summaries from proposal
  const specSummary = new Map<string, { summary: string; insightCount: number }>();
  for (const s of proposal.specs) specSummary.set(s.name, s);

  // Build unified tree
  const nodeMap = new Map<string, TreeNode>();

  for (const t of topics) {
    const mergeTarget = mergedAway.get(t.name);
    nodeMap.set(t.name, {
      id: t.id,
      name: t.name,
      summary: t.summary,
      parentName: topics.find((p) => p.id === t.parent_topic_id)?.name ?? null,
      children: [],
      insightCount: t.insight_count,
      change: mergeTarget
        ? { type: "merge" as const, from: [t.name], into: mergeTarget, mergedInto: mergeTarget }
        : changeByName.get(t.name) ?? null,
    });
  }

  // Add new specs
  for (const c of proposal.changes) {
    const name = c.type === "merge" ? c.into : c.spec;
    if (!name || nodeMap.has(name)) continue;
    const spec = specSummary.get(name);
    nodeMap.set(name, {
      id: null,
      name,
      summary: spec?.summary ?? "",
      parentName: c.parent ?? null,
      children: [],
      insightCount: spec?.insightCount ?? 0,
      change: c,
    });
  }

  // Link children
  const roots: TreeNode[] = [];
  for (const node of nodeMap.values()) {
    if (node.parentName && nodeMap.has(node.parentName)) {
      nodeMap.get(node.parentName)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort: changed first, then alphabetical
  function sortNodes(nodes: TreeNode[]) {
    nodes.sort((a, b) => {
      if (a.change && !b.change) return -1;
      if (!a.change && b.change) return 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) sortNodes(n.children);
  }
  sortNodes(roots);

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">Brain Sync Preview</h2>
        <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><Plus className="size-3 text-emerald-600" /> new</span>
          <span className="flex items-center gap-1"><Pencil className="size-3 text-blue-600" /> updated</span>
          <span className="flex items-center gap-1"><Merge className="size-3 text-amber-600" /> merged</span>
          <span className="text-muted-foreground/50">unchanged</span>
        </div>
      </div>
      <div className="font-mono text-[13px]">
        {roots.map((node) => (
          <DiffTreeNode key={node.name} node={node} depth={0} onTopicClick={onTopicClick} specSummary={specSummary} />
        ))}
      </div>
    </div>
  );
}

function DiffTreeNode({
  node,
  depth,
  onTopicClick,
  specSummary,
}: {
  node: TreeNode;
  depth: number;
  onTopicClick?: (topicId: string) => void;
  specSummary: Map<string, { summary: string; insightCount: number }>;
}) {
  const hasChildren = node.children.length > 0;
  const [expanded, setExpanded] = useState(true);
  const [hovered, setHovered] = useState(false);

  const change = node.change;
  const changeType = change?.mergedInto ? "delete" : change?.type;
  const colors = changeType ? CHANGE_COLORS[changeType as keyof typeof CHANGE_COLORS] : null;
  const Icon = changeType ? CHANGE_ICONS[changeType as keyof typeof CHANGE_ICONS] : null;
  const isClickable = !!(node.id && onTopicClick && !change?.mergedInto);

  return (
    <div>
      <div
        className={`flex items-center h-7 relative group ${
          colors ? colors.bg : "hover:bg-accent/50"
        } ${isClickable ? "cursor-pointer" : ""}`}
        style={{ paddingLeft: depth * 16 + 4 }}
        onClick={() => isClickable && onTopicClick!(node.id!)}
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

        {Icon && <Icon className={`size-3 shrink-0 ml-0.5 mr-1.5 ${colors!.text}`} />}

        <span className={`truncate ${colors ? colors.text : "text-muted-foreground"}`}>
          {node.name}
        </span>

        {/* Merge annotation */}
        {change?.mergedInto && (
          <span className="ml-2 text-[10px] text-amber-600 dark:text-amber-400 font-sans">
            → {change.mergedInto}
          </span>
        )}

        {/* Change type label */}
        {changeType && !change?.mergedInto && (
          <span className={`ml-2 text-[10px] ${colors!.text} font-sans`}>
            {changeType}
          </span>
        )}

        {/* Hover card */}
        {hovered && (node.summary || change) && (
          <div
            className="absolute left-full top-0 ml-2 z-50 w-80 p-3 rounded-lg border bg-popover text-popover-foreground shadow-lg text-xs font-sans animate-in fade-in duration-100"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            <div className="font-semibold text-sm mb-1 flex items-center gap-2">
              {node.name}
              {changeType && (
                <span className={`text-[10px] font-normal ${colors!.text}`}>{changeType}</span>
              )}
            </div>

            {/* Summary */}
            {node.summary && (
              <p className="text-muted-foreground leading-relaxed">
                {node.summary.slice(0, 250)}{node.summary.length > 250 ? "..." : ""}
              </p>
            )}

            {/* For new/updated: show insight count from proposal */}
            {changeType && changeType !== "delete" && (
              <div className="mt-2 text-[10px] text-muted-foreground">
                {specSummary.get(node.name)?.insightCount ?? node.insightCount} insights
              </div>
            )}

            {/* For merge sources: show what they're merging into */}
            {change?.mergedInto && (
              <p className="mt-2 text-amber-600 dark:text-amber-400">
                Being merged into <strong>{change.mergedInto}</strong>
              </p>
            )}

            {/* For merge targets: show what's being merged in */}
            {change?.type === "merge" && change.from && !change.mergedInto && (
              <p className="mt-2 text-amber-600 dark:text-amber-400">
                Merging: {change.from.join(", ")}
              </p>
            )}
          </div>
        )}
      </div>

      {expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <DiffTreeNode key={child.name} node={child} depth={depth + 1} onTopicClick={onTopicClick} specSummary={specSummary} />
          ))}
        </div>
      )}
    </div>
  );
}
