import { useState } from "react";
import { proposeBrainSync, applyBrainSync } from "../api";
import type { BrainSyncProposal, BrainSyncChange } from "../types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Check, Plus, Pencil, Merge, Loader2, Brain, Sparkles } from "lucide-react";

interface Props {
  repoId: string;
  onSynced: () => void;
}

const CHANGE_ICONS: Record<string, typeof Plus> = {
  add: Plus,
  update: Pencil,
  merge: Merge,
};

const CHANGE_COLORS: Record<string, string> = {
  add: "text-emerald-600",
  update: "text-blue-500",
  merge: "text-amber-500",
};

type SyncPhase = "idle" | "analyzing" | "extracting" | "organizing" | "writing" | "reviewing" | "applying" | "done";

const PHASE_LABELS: Record<string, string> = {
  analyzing: "Finding new sessions...",
  extracting: "Extracting knowledge...",
  organizing: "Building knowledge tree...",
  writing: "Writing specs...",
  applying: "Updating brain...",
};

export function BrainSync({ repoId, onSynced }: Props) {
  const [phase, setPhase] = useState<SyncPhase>("idle");
  const [proposal, setProposal] = useState<BrainSyncProposal | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handlePropose = async () => {
    setError(null);

    // Animate through phases
    setPhase("analyzing");
    await sleep(400);
    setPhase("extracting");

    try {
      const result = await proposeBrainSync(repoId);
      if (result.status === "up_to_date") {
        setPhase("idle");
        setError("Brain is up to date — no new sessions.");
        return;
      }

      setPhase("organizing");
      await sleep(300);
      setPhase("writing");
      await sleep(300);

      setProposal(result);
      setPhase("reviewing");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("idle");
    }
  };

  const handleApply = async () => {
    if (!proposal) return;
    setPhase("applying");
    setError(null);
    try {
      await applyBrainSync(repoId, proposal.sessions.map((s) => s.id));
      setPhase("done");
      setTimeout(() => {
        onSynced();
        setPhase("idle");
        setProposal(null);
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("reviewing");
    }
  };

  const handleDismiss = () => {
    setPhase("idle");
    setProposal(null);
    setError(null);
  };

  // ── Idle state ──
  if (phase === "idle") {
    return (
      <div className="space-y-2">
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-2"
          onClick={handlePropose}
        >
          <RefreshCw className="size-3.5" />
          Sync Brain
        </Button>
        {error && (
          <p className="text-[11px] text-muted-foreground text-center animate-in fade-in duration-300">{error}</p>
        )}
      </div>
    );
  }

  // ── Processing phases ──
  if (phase !== "reviewing" && phase !== "done") {
    const label = PHASE_LABELS[phase] || "Processing...";
    return (
      <div className="py-3 space-y-3 animate-in fade-in duration-200">
        <div className="flex items-center justify-center gap-2">
          <div className="relative">
            <Brain className="size-5 text-primary animate-pulse" />
            <Sparkles className="size-3 text-amber-400 absolute -top-1 -right-1 animate-bounce" />
          </div>
        </div>
        <div className="space-y-1.5">
          {Object.entries(PHASE_LABELS).map(([key, text]) => {
            const phaseOrder = ["analyzing", "extracting", "organizing", "writing"];
            const currentIdx = phaseOrder.indexOf(phase);
            const thisIdx = phaseOrder.indexOf(key);
            const isDone = thisIdx < currentIdx;
            const isCurrent = key === phase;

            return (
              <div
                key={key}
                className={`flex items-center gap-2 text-xs transition-all duration-300 ${
                  isCurrent ? "text-foreground font-medium" : isDone ? "text-muted-foreground" : "text-muted-foreground/40"
                }`}
              >
                {isDone ? (
                  <Check className="size-3 text-emerald-500" />
                ) : isCurrent ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <div className="size-3" />
                )}
                {text}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Done state ──
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

  // ── Reviewing state ──
  if (!proposal) return null;

  return (
    <div className="space-y-3 animate-in slide-in-from-bottom-2 duration-300">
      {/* Sessions */}
      <div>
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
          {proposal.sessions.length} new session{proposal.sessions.length !== 1 ? "s" : ""}
        </p>
        {proposal.sessions.map((s) => (
          <p key={s.id} className="text-[11px] text-muted-foreground truncate leading-relaxed">
            {s.summary || s.shape}
          </p>
        ))}
      </div>

      {/* Changes */}
      <div>
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
          {proposal.changes.length} change{proposal.changes.length !== 1 ? "s" : ""}
        </p>
        <div className="space-y-1">
          {proposal.changes.map((change: BrainSyncChange, i: number) => {
            const Icon = CHANGE_ICONS[change.type] || Plus;
            const color = CHANGE_COLORS[change.type] || "";
            const label = change.type === "merge"
              ? `${change.from?.join(" + ")} → ${change.into}`
              : change.spec;

            return (
              <Card key={i} className="p-2 flex items-center gap-2 animate-in fade-in slide-in-from-left-1 duration-200" style={{ animationDelay: `${i * 50}ms` }}>
                <Icon className={`size-3 shrink-0 ${color}`} />
                <span className="text-xs truncate flex-1">{label}</span>
                <Badge variant="outline" className="text-[9px] shrink-0 px-1 py-0">
                  {change.type}
                </Badge>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Button size="sm" className="flex-1 gap-1.5" onClick={handleApply}>
          <Check className="size-3" />
          Apply
        </Button>
        <Button variant="ghost" size="sm" onClick={handleDismiss}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
