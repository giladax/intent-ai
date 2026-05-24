import { useState } from "react";
import { proposeBrainSync, applyBrainSync } from "../api";
import type { BrainSyncProposal, BrainSyncChange } from "../types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Check, Plus, Pencil, Merge, Loader2 } from "lucide-react";

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

export function BrainSync({ repoId, onSynced }: Props) {
  const [state, setState] = useState<"idle" | "proposing" | "reviewing" | "applying" | "done">("idle");
  const [proposal, setProposal] = useState<BrainSyncProposal | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handlePropose = async () => {
    setState("proposing");
    setError(null);
    try {
      const result = await proposeBrainSync(repoId);
      setProposal(result);
      setState(result.status === "up_to_date" ? "idle" : "reviewing");
      if (result.status === "up_to_date") {
        setError("Brain is up to date — no new sessions to process.");
      }
    } catch (err) {
      setError(String(err));
      setState("idle");
    }
  };

  const handleApply = async () => {
    if (!proposal) return;
    setState("applying");
    setError(null);
    try {
      await applyBrainSync(repoId, proposal.sessions.map((s) => s.id));
      setState("done");
      onSynced();
    } catch (err) {
      setError(String(err));
      setState("reviewing");
    }
  };

  const handleDismiss = () => {
    setState("idle");
    setProposal(null);
    setError(null);
  };

  if (state === "idle") {
    return (
      <div className="space-y-2">
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={handlePropose}
        >
          <RefreshCw className="size-3.5 mr-2" />
          Sync Brain
        </Button>
        {error && (
          <p className="text-xs text-muted-foreground text-center">{error}</p>
        )}
      </div>
    );
  }

  if (state === "proposing") {
    return (
      <div className="flex items-center justify-center py-4 gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Analyzing sessions...
      </div>
    );
  }

  if (state === "applying") {
    return (
      <div className="flex items-center justify-center py-4 gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Applying changes...
      </div>
    );
  }

  if (state === "done") {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-center py-3 gap-2 text-sm text-emerald-600">
          <Check className="size-4" />
          Brain updated
        </div>
        <Button variant="ghost" size="sm" className="w-full" onClick={handleDismiss}>
          Dismiss
        </Button>
      </div>
    );
  }

  // Reviewing
  if (!proposal) return null;

  return (
    <div className="space-y-3">
      {/* Sessions being processed */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
          {proposal.sessions.length} new session{proposal.sessions.length !== 1 ? "s" : ""}
        </p>
        {proposal.sessions.map((s) => (
          <p key={s.id} className="text-xs text-muted-foreground truncate">
            {s.summary || s.shape}
          </p>
        ))}
      </div>

      {/* Proposed changes */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          Proposed Changes
        </p>
        <div className="space-y-1.5">
          {proposal.changes.map((change: BrainSyncChange, i: number) => {
            const Icon = CHANGE_ICONS[change.type] || Plus;
            const color = CHANGE_COLORS[change.type] || "";
            const label = change.type === "merge"
              ? `${change.from?.join(" + ")} → ${change.into}`
              : `${change.spec}`;

            return (
              <Card key={i} className="p-2 flex items-center gap-2">
                <Icon className={`size-3.5 shrink-0 ${color}`} />
                <div className="min-w-0 flex-1">
                  <span className="text-sm truncate block">{label}</span>
                  {change.parent && (
                    <span className="text-xs text-muted-foreground">in {change.parent}</span>
                  )}
                </div>
                <Badge variant="outline" className="text-[10px] shrink-0">
                  {change.type}
                </Badge>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Button size="sm" className="flex-1" onClick={handleApply}>
          <Check className="size-3.5 mr-1" />
          Apply ({proposal.changes.length})
        </Button>
        <Button variant="ghost" size="sm" onClick={handleDismiss}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
