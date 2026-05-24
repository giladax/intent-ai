import { useState, useEffect } from "react";
import { discoverBrainSessions, getSyncStatus } from "../api";
import type { BrainSyncSession, BrainSyncChange, BrainSyncProposal } from "../types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCw, Check, Plus, Pencil, Merge, Loader2,
  Brain, Sparkles, CircleDot, CircleMinus, Download,
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
          onEvent(JSON.parse(line.slice(6)));
        } catch {
          // skip malformed lines
        }
      }
    }
  }
}

export function BrainSync({ repoId, onSynced }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [sessions, setSessions] = useState<BrainSyncSession[]>([]);
  const [proposal, setProposal] = useState<BrainSyncProposal | null>(null);
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
        if (job.sessions) setSessions(job.sessions);
        setProposal(job.proposal);
        setDigestedCount(job.digestedCount ?? 0);
        setPhase("reviewing");
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
    setPhase("proposing");
    setProgressMessage("Extracting knowledge...");

    try {
      const response = await fetch("/api/brain/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId, sessionIds: selected.map(s => s.id) }),
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
    const selected = sessions.filter(s => s.selected);
    if (selected.length === 0) return;
    setPhase("applying");
    setProgressMessage("Applying changes...");

    try {
      const response = await fetch("/api/brain/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId, sessionIds: selected.map(s => s.id) }),
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
    return (
      <div className="space-y-2 animate-in slide-in-from-bottom-2 duration-300">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
          {proposal.changes.length} changes
        </p>
        <div className="max-h-48 overflow-y-auto space-y-0.5 pr-1">
          {proposal.changes.map((change: BrainSyncChange, i: number) => {
            const Icon = CHANGE_ICONS[change.type] || Plus;
            const color = CHANGE_COLORS[change.type] || "";
            const label = change.type === "merge"
              ? `${change.from?.join(" + ")} → ${change.into}`
              : change.spec;

            return (
              <div key={i} className="flex items-center gap-1.5 py-1 text-xs">
                <Icon className={`size-3 shrink-0 ${color}`} />
                <span className="truncate flex-1">{label}</span>
                <span className="text-[9px] text-muted-foreground shrink-0">{change.type}</span>
              </div>
            );
          })}
        </div>
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
