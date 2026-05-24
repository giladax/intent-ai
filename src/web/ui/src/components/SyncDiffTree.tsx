import { useState } from "react";
import type { TopicSummary, BrainSyncProposal, BrainSyncChange } from "../types";
import { ChevronRight, Plus, Pencil, Merge } from "lucide-react";

interface Props {
  topics: TopicSummary[];
  proposal: BrainSyncProposal;
}

// Colors for change types
const CHANGE_BG: Record<string, string> = {
  add: "bg-emerald-50 dark:bg-emerald-950/30",
  update: "bg-blue-50 dark:bg-blue-950/30",
  merge: "bg-amber-50 dark:bg-amber-950/30",
};
const CHANGE_BORDER: Record<string, string> = {
  add: "border-emerald-300 dark:border-emerald-700",
  update: "border-blue-300 dark:border-blue-700",
  merge: "border-amber-300 dark:border-amber-700",
};
const CHANGE_TEXT: Record<string, string> = {
  add: "text-emerald-700 dark:text-emerald-400",
  update: "text-blue-700 dark:text-blue-400",
  merge: "text-amber-700 dark:text-amber-400",
};
const CHANGE_ICON: Record<string, typeof Plus> = {
  add: Plus,
  update: Pencil,
  merge: Merge,
};

interface TreeNode {
  name: string;
  summary: string;
  parentName: string | null;
  children: TreeNode[];
  insightCount: number;
  change: BrainSyncChange | null; // null = existing unchanged
}

export function SyncDiffTree({ topics, proposal }: Props) {
  // Build change lookup
  const changeByName = new Map<string, BrainSyncChange>();
  for (const c of proposal.changes) {
    const name = c.type === "merge" ? c.into : c.spec;
    if (name) changeByName.set(name, c);
  }

  // Build spec summary lookup from proposal
  const specSummary = new Map<string, { summary: string; insightCount: number }>();
  for (const s of proposal.specs) specSummary.set(s.name, s);

  // Build unified tree: existing topics + new additions
  const nodeMap = new Map<string, TreeNode>();

  // Add existing topics
  for (const t of topics) {
    nodeMap.set(t.name, {
      name: t.name,
      summary: t.summary,
      parentName: topics.find((p) => p.id === t.parent_topic_id)?.name ?? null,
      children: [],
      insightCount: t.insight_count,
      change: changeByName.get(t.name) ?? null,
    });
  }

  // Add new specs from proposal that don't exist yet
  for (const c of proposal.changes) {
    const name = c.type === "merge" ? c.into : c.spec;
    if (!name || nodeMap.has(name)) continue;
    const spec = specSummary.get(name);
    nodeMap.set(name, {
      name,
      summary: spec?.summary ?? "",
      parentName: c.parent ?? null,
      children: [],
      insightCount: spec?.insightCount ?? 0,
      change: c,
    });
  }

  // Link children to parents
  const roots: TreeNode[] = [];
  for (const node of nodeMap.values()) {
    if (node.parentName && nodeMap.has(node.parentName)) {
      nodeMap.get(node.parentName)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort: changed items first, then alphabetical
  function sortNodes(nodes: TreeNode[]) {
    nodes.sort((a, b) => {
      const aChanged = a.change ? 1 : 0;
      const bChanged = b.change ? 1 : 0;
      if (aChanged !== bChanged) return bChanged - aChanged; // changed first
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) sortNodes(n.children);
  }
  sortNodes(roots);

  // Count changes in subtree
  function countChanges(node: TreeNode): number {
    let count = node.change ? 1 : 0;
    for (const c of node.children) count += countChanges(c);
    return count;
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h2 className="text-lg font-semibold">Brain Sync Preview</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Review changes before applying.
          <span className={`inline-flex items-center gap-1 mx-1.5 ${CHANGE_TEXT.add}`}><Plus className="size-3" /> new</span>
          <span className={`inline-flex items-center gap-1 mx-1.5 ${CHANGE_TEXT.update}`}><Pencil className="size-3" /> updated</span>
          <span className={`inline-flex items-center gap-1 mx-1.5 ${CHANGE_TEXT.merge}`}><Merge className="size-3" /> merged</span>
        </p>
      </div>
      <div className="space-y-0.5">
        {roots.map((node) => (
          <DiffNode key={node.name} node={node} depth={0} countChanges={countChanges} />
        ))}
      </div>
    </div>
  );
}

function DiffNode({
  node,
  depth,
  countChanges,
}: {
  node: TreeNode;
  depth: number;
  countChanges: (n: TreeNode) => number;
}) {
  const hasChildren = node.children.length > 0;
  const childChangeCount = hasChildren ? countChanges(node) - (node.change ? 1 : 0) : 0;
  const [expanded, setExpanded] = useState(
    // Auto-expand if this node or children have changes
    !!(node.change || childChangeCount > 0)
  );

  const change = node.change;
  const changeType = change?.type;
  const Icon = changeType ? CHANGE_ICON[changeType] : null;

  return (
    <div style={{ marginLeft: depth * 20 }}>
      <button
        className={`flex items-start gap-2 py-2 px-3 w-full text-left text-sm rounded-lg transition-all ${
          change
            ? `${CHANGE_BG[changeType!]} border ${CHANGE_BORDER[changeType!]}`
            : "hover:bg-muted/40"
        }`}
        onClick={() => hasChildren && setExpanded(!expanded)}
      >
        {/* Expand chevron */}
        {hasChildren ? (
          <ChevronRight
            className={`size-4 shrink-0 mt-0.5 text-muted-foreground transition-transform ${
              expanded ? "rotate-90" : ""
            }`}
          />
        ) : (
          <span className="w-4 shrink-0" />
        )}

        {/* Change icon */}
        {Icon && <Icon className={`size-4 shrink-0 mt-0.5 ${CHANGE_TEXT[changeType!]}`} />}

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`font-medium ${change ? CHANGE_TEXT[changeType!] : "text-muted-foreground"}`}>
              {node.name}
            </span>
            {changeType && (
              <span className={`text-[10px] font-medium uppercase ${CHANGE_TEXT[changeType]}`}>
                {changeType}
              </span>
            )}
            {!change && childChangeCount > 0 && (
              <span className="text-[10px] text-muted-foreground">
                {childChangeCount} change{childChangeCount !== 1 ? "s" : ""} below
              </span>
            )}
          </div>
          {change && node.summary && (
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              {node.summary.slice(0, 180)}
              {node.summary.length > 180 ? "..." : ""}
            </p>
          )}
          {change?.type === "merge" && change.from && (
            <p className="text-[11px] mt-1 opacity-70">
              merging: {change.from.join(", ")}
            </p>
          )}
        </div>

        {/* Insight count */}
        {node.insightCount > 0 && (
          <span className="text-[10px] text-muted-foreground shrink-0 mt-1">
            {node.insightCount} insights
          </span>
        )}
      </button>

      {expanded && hasChildren && (
        <div className="space-y-0.5 mt-0.5">
          {node.children.map((child) => (
            <DiffNode key={child.name} node={child} depth={depth + 1} countChanges={countChanges} />
          ))}
        </div>
      )}
    </div>
  );
}
