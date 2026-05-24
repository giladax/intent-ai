import { useState, useEffect } from "react";
import { discoverBrainSessions, getSyncStatus } from "../api";
import type { BrainSyncSession, BrainSyncChange, BrainSyncProposal } from "../types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCw, Check, Plus, Pencil, Merge, Loader2,
  Brain, Sparkles, CircleDot, CircleMinus, Download,
  ChevronRight,
} from "lucide-react";

interface Props {
  repoId: string;
  onSynced: () => void;
}

const CHANGE_ICONS: Record<string, typeof Plus> = { add: Plus, update: Pencil, merge: Merge };
const CHANGE_COLORS: Record<string, string> = { add: "text-emerald-600", update: "text-blue-500", merge: "text-amber-500" };
const CONFIDENCE_COLORS: Record<string, string> = { high: "bg-emerald-500", medium: "bg-amber-400", low: "bg-muted-foreground/30" };

type Phase =
  | "idle"
  | "discovering"
  | "needs_digest"     // undigested logs found
  | "digesting"        // running digest pipeline
  | "selecting"
  | "proposing"
  | "reviewing"
  | "applying"
  | "done";

const PROGRESS_STEPS = [
  { key: "discovering", label: "Discovering sessions..." },
  { key: "proposing", label: "Synthesizing knowledge..." },
  { key: "applying", label: "Updating brain..." },
];

/** Read an SSE stream and call onEvent for each parsed data line. */
async function readSSE(
  response: Response,
  onEvent: (data: any) => void,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const parsed = JSON.parse(line.slice(6));
          onEvent(parsed);
        } catch (e) {
          // Only skip JSON parse errors, not callback errors
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
    }
  }
}

// ── Expandable change item with hierarchy ──

function ChangeItem({
  change,
  specMap,
  childrenOf,
  depth,
}: {
  change: BrainSyncChange;
  specMap: Map<string, { summary: string; insightCount: number }>;
  childrenOf: Map<string, BrainSyncChange[]>;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const Icon = CHANGE_ICONS[change.type] || Plus;
  const color = CHANGE_COLORS[change.type] || "";
  const name = change.type === "merge" ? change.into : change.spec;
  const label = change.type === "merge"
    ? `${change.from?.join(" + ")} → ${change.into}`
    : change.spec ?? "";
  const spec = name ? specMap.get(name) : null;
  const children = name ? (childrenOf.get(name) || []) : [];
  const hasDetail = !!(spec?.summary || children.length > 0);

  return (
    <div style={{ paddingLeft: depth * 12 }}>
      <button
        className={`flex items-center gap-1.5 py-1.5 w-full text-left text-xs rounded-md px-1.5 transition-colors ${
          expanded ? "bg-muted/50" : "hover:bg-muted/30"
        }`}
        onClick={() => hasDetail && setExpanded(!expanded)}
      >
        {hasDetail ? (
          <ChevronRight className={`size-3 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <Icon className={`size-3 shrink-0 ${color}`} />
        <span className="truncate flex-1 font-medium">{label}</span>
        <Badge variant="outline" className="text-[9px] shrink-0 ml-1">{change.type}</Badge>
        {change.parent && !depth && (
          <span className="text-[9px] text-muted-foreground shrink-0">in {change.parent}</span>
        )}
      </button>

      {expanded && (
        <div className="ml-[18px] pl-3 border-l border-muted-foreground/15 space-y-1 pb-1 animate-in slide-in-from-top-1 duration-150">
          {spec?.summary && (
            <p className="text-[11px] text-muted-foreground leading-relaxed py-1">
              {spec.summary}
            </p>
          )}
          {spec && spec.insightCount > 0 && (
            <span className="text-[10px] text-muted-foreground">
              {spec.insightCount} insight{spec.insightCount !== 1 ? "s" : ""}
            </span>
          )}
          {children.map((child, j) => (
            <ChangeItem
              key={j}
              change={child}
              specMap={specMap}
              childrenOf={childrenOf}
              depth={0}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function BrainSync({ repoId, onSynced }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [sessions, setSessions] = useState<BrainSyncSession[]>([]);
  const [proposal, setProposal] = useState<BrainSyncProposal | null>(null);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [digestedCount, setDigestedCount] = useState(0);
  const [undigestedCount, setUndigestedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);

  // Recover server-side job state on mount (survives page refresh)
  useEffect(() => {
    getSyncStatus(repoId).then((job) => {
      if (!job || job.phase === "done" || job.phase === "error") return;
      // Restore phase and associated data
      if (job.phase === "selecting" && job.sessions) {
        setSessions(job.sessions);
        setDigestedCount(job.digestedCount ?? 0);
        setPhase("selecting");
      } else if (job.phase === "reviewing" && job.proposal) {
        if (job.sessions) {
          setSessions(job.sessions);
          setSelectedSessionIds(job.sessions.filter((s: any) => s.selected).map((s: any) => s.id));
        }
        setProposal(job.proposal);
        setDigestedCount(job.digestedCount ?? 0);
        setPhase("reviewing");
      } else if (job.phase === "digesting") {
        // Digest in progress — show progress
        setPhase("digesting");
        if (job.digestedCount) setDigestedCount(job.digestedCount);
        const total = (job as any).digestTotal;
        setProgressMessage(total
          ? `Digesting... (${job.digestedCount ?? 0}/${total})`
          : "Digesting...");
      } else if (job.phase === "discovering" || job.phase === "proposing" || job.phase === "applying") {
        // Server is still processing — show the spinner
        setPhase(job.phase);
        if (job.sessions) setSessions(job.sessions);
        if (job.digestedCount) setDigestedCount(job.digestedCount);
      }
    }).catch(() => {
      // Ignore — sync status is best-effort
    });
  }, [repoId]);

  const handleDiscover = async () => {
    setError(null);
    setPhase("discovering");
    try {
      const result = await discoverBrainSessions(repoId);
      setDigestedCount(result.digestedCount);
      if (result.status === "up_to_date") {
        if ((result as any).undigestedCount > 0) {
          setUndigestedCount((result as any).undigestedCount);
          setPhase("needs_digest");
        } else {
          setPhase("idle");
          setError("Brain is up to date — no new sessions.");
        }
        return;
      }
      setSessions(result.sessions);
      setPhase("selecting");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("idle");
    }
  };

  const toggleSession = (id: string) => {
    setSessions(prev => prev.map(s =>
      s.id === id ? { ...s, selected: !s.selected } : s
    ));
  };

  const handlePropose = async () => {
    const selected = sessions.filter(s => s.selected);
    if (selected.length === 0) return;
    const ids = selected.map(s => s.id);
    setSelectedSessionIds(ids);
    setPhase("proposing");
    setProgressMessage("Extracting knowledge...");

    try {
      const response = await fetch("/api/brain/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId, sessionIds: ids }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`${response.status}: ${body}`);
      }

      await readSSE(response, (data) => {
        if (data.phase === "error") {
          throw new Error(data.message || "Synthesis failed");
        } else if (data.phase === "done") {
          setProposal(data.proposal);
          setPhase("reviewing");
          setProgressMessage(null);
        } else {
          setProgressMessage(data.message || "Processing...");
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("selecting");
      setProgressMessage(null);
    }
  };

  const handleApply = async () => {
    setPhase("applying");
    setProgressMessage("Applying changes...");

    try {
      // Resolve session IDs: state → proposal → sessions list → let server handle it
      const ids = selectedSessionIds.length > 0
        ? selectedSessionIds
        : (proposal as any)?.sessionIds?.length > 0
          ? (proposal as any).sessionIds
          : sessions.filter(s => s.selected).map(s => s.id);

      const response = await fetch("/api/brain/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId, sessionIds: ids.length > 0 ? ids : undefined }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`${response.status}: ${body}`);
      }

      await readSSE(response, (data) => {
        if (data.phase === "error") {
          throw new Error(data.message || "Apply failed");
        } else if (data.phase === "done") {
          setPhase("done");
          setProgressMessage(null);
          setTimeout(() => {
            onSynced();
            setPhase("idle");
            setProposal(null);
            setSessions([]);
          }, 2000);
        } else {
          setProgressMessage(data.message || "Processing...");
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("reviewing");
      setProgressMessage(null);
    }
  };

  const handleDigest = async () => {
    setPhase("digesting");
    setProgressMessage(`Digesting ${undigestedCount} session(s)...`);
    try {
      const response = await fetch("/api/brain/digest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId }),
      });
      if (!response.ok) throw new Error(`${response.status}`);
      await readSSE(response, (data) => {
        if (data.phase === "done") {
          setDigestedCount(data.digestedCount || 0);
          // Auto-continue to discover
          handleDiscover();
        } else if (data.phase === "error") {
          setError(data.message);
          setPhase("idle");
        } else {
          setProgressMessage(data.message || "Digesting...");
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("idle");
    }
  };

  const handleDismiss = () => {
    setPhase("idle");
    setProposal(null);
    setSessions([]);
    setError(null);
    setUndigestedCount(0);
  };

  // ── Idle ──
  if (phase === "idle") {
    return (
      <div className="space-y-2">
        <Button variant="outline" size="sm" className="w-full gap-2" onClick={handleDiscover}>
          <RefreshCw className="size-3.5" />
          Sync Brain
        </Button>
        {error && <p className="text-[11px] text-muted-foreground text-center animate-in fade-in duration-300">{error}</p>}
      </div>
    );
  }

  // ── Needs digest ──
  if (phase === "needs_digest") {
    return (
      <div className="space-y-2 animate-in fade-in duration-200">
        <p className="text-[11px] text-muted-foreground">
          {undigestedCount} session log{undigestedCount !== 1 ? "s" : ""} found
        </p>
        <Button size="sm" className="w-full gap-2" onClick={handleDigest}>
          <Download className="size-3.5" />
          Digest Sessions
        </Button>
        <Button variant="ghost" size="sm" className="w-full" onClick={handleDismiss}>
          Cancel
        </Button>
      </div>
    );
  }

  // ── Digesting ──
  if (phase === "digesting") {
    return (
      <div className="py-3 space-y-2 animate-in fade-in duration-200">
        <div className="flex items-center justify-center">
          <Loader2 className="size-4 animate-spin text-primary" />
        </div>
        <p className="text-xs text-center text-muted-foreground">{progressMessage || "Digesting..."}</p>
      </div>
    );
  }

  // ── Processing (discovering / proposing / applying) ──
  if (phase === "discovering" || phase === "proposing" || phase === "applying") {
    return (
      <div className="py-3 space-y-3 animate-in fade-in duration-200">
        <div className="flex items-center justify-center gap-2">
          <div className="relative">
            <Brain className="size-5 text-primary animate-pulse" />
            <Sparkles className="size-3 text-amber-400 absolute -top-1 -right-1 animate-bounce" />
          </div>
        </div>
        <div className="space-y-1.5">
          {PROGRESS_STEPS.map((step) => {
            const stepOrder = PROGRESS_STEPS.map(s => s.key);
            const currentIdx = stepOrder.indexOf(phase);
            const thisIdx = stepOrder.indexOf(step.key);
            const isDone = thisIdx < currentIdx;
            const isCurrent = step.key === phase;

            return (
              <div key={step.key} className={`flex items-center gap-2 text-xs transition-all duration-300 ${
                isCurrent ? "text-foreground font-medium" : isDone ? "text-muted-foreground" : "text-muted-foreground/40"
              }`}>
                {isDone ? <Check className="size-3 text-emerald-500" /> :
                 isCurrent ? <Loader2 className="size-3 animate-spin" /> :
                 <div className="size-3" />}
                {isCurrent && progressMessage ? progressMessage : step.label}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Done ──
  if (phase === "done") {
    return (
      <div className="py-3 animate-in fade-in zoom-in-95 duration-300">
        <div className="flex flex-col items-center gap-1.5">
          <div className="size-8 rounded-full bg-emerald-500/10 flex items-center justify-center">
            <Check className="size-4 text-emerald-500" />
          </div>
          <p className="text-sm font-medium text-emerald-600">Brain updated</p>
        </div>
      </div>
    );
  }

  // ── Selecting sessions ──
  if (phase === "selecting") {
    const selectedCount = sessions.filter(s => s.selected).length;
    return (
      <div className="space-y-3 animate-in slide-in-from-bottom-2 duration-300">
        {digestedCount > 0 && (
          <p className="text-[11px] text-emerald-600 animate-in fade-in duration-300">
            Digested {digestedCount} new session{digestedCount !== 1 ? "s" : ""}
          </p>
        )}
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
          {sessions.length} session{sessions.length !== 1 ? "s" : ""} to process
        </p>
        <div className="space-y-1">
          {sessions.map((s, i) => (
            <Card
              key={s.id}
              className={`p-2 cursor-pointer transition-all duration-200 animate-in fade-in slide-in-from-left-1 ${
                s.selected ? "ring-1 ring-primary/50" : "opacity-60"
              }`}
              style={{ animationDelay: `${i * 40}ms` }}
              onClick={() => toggleSession(s.id)}
            >
              <div className="flex items-center gap-2">
                {s.selected
                  ? <CircleDot className="size-3.5 text-primary shrink-0" />
                  : <CircleMinus className="size-3.5 text-muted-foreground/40 shrink-0" />
                }
                <div className="min-w-0 flex-1">
                  <p className="text-xs truncate">{s.summary || s.shape}</p>
                </div>
                <div className={`size-2 rounded-full shrink-0 ${CONFIDENCE_COLORS[s.confidence]}`}
                  title={`${s.confidence} confidence (files: ${s.fileScore}%, time: ${s.timeScore}%)`}
                />
              </div>
            </Card>
          ))}
        </div>
        <div className="flex gap-2">
          <Button size="sm" className="flex-1 gap-1.5" onClick={handlePropose} disabled={selectedCount === 0}>
            Synthesize ({selectedCount})
          </Button>
          <Button variant="ghost" size="sm" onClick={handleDismiss}>Cancel</Button>
        </div>
      </div>
    );
  }

  // ── Reviewing proposed changes ──
  if (phase === "reviewing" && proposal) {
    // Build spec lookup for summaries
    const specMap = new Map<string, { summary: string; insightCount: number }>();
    for (const s of proposal.specs) specMap.set(s.name, s);

    // Group changes by parent for hierarchy
    const roots: BrainSyncChange[] = [];
    const childrenOf = new Map<string, BrainSyncChange[]>();
    for (const change of proposal.changes) {
      const parentName = change.parent;
      // Check if parent is also a change in this proposal
      const parentIsChange = parentName && proposal.changes.some(
        (c: BrainSyncChange) => c.spec === parentName || c.into === parentName
      );
      if (parentIsChange) {
        const key = parentName!;
        const list = childrenOf.get(key) || [];
        list.push(change);
        childrenOf.set(key, list);
      } else {
        roots.push(change);
      }
    }

    return (
      <div className="space-y-2 animate-in slide-in-from-bottom-2 duration-300">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
          {proposal.changes.length} changes
        </p>
        <div className="max-h-64 overflow-y-auto space-y-1 pr-1">
          {roots.map((change, i) => (
            <ChangeItem
              key={i}
              change={change}
              specMap={specMap}
              childrenOf={childrenOf}
              depth={0}
            />
          ))}
        </div>
        {error && (
          <p className="text-[11px] text-destructive text-center animate-in fade-in duration-300">{error}</p>
        )}
        <div className="flex gap-2 pt-1">
          <Button size="sm" className="flex-1 gap-1.5" onClick={handleApply}>
            <Check className="size-3" />
            Apply ({proposal.changes.length})
          </Button>
          <Button variant="ghost" size="sm" onClick={handleDismiss}>Cancel</Button>
        </div>
      </div>
    );
  }

  return null;
}
