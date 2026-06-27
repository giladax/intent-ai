import { useState, useEffect, useCallback } from "react";
import {
  fetchPendingObservations,
  approveObservation,
  rejectObservation,
  editObservation,
} from "../api";
import type { PendingObservation } from "../types";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, X, Pencil, Inbox } from "lucide-react";

interface Props {
  repoId: string | null;
  /** Click-through to the feature an observation is attached to. */
  onFeatureClick?: (featureId: string) => void;
}

/** The `<kind>` part of an `observation:<kind>` category. */
function kindOf(category: string): string {
  return category.startsWith("observation:") ? category.slice("observation:".length) : category;
}

const KIND_COLORS: Record<string, string> = {
  constraint: "bg-amber-500",
  unknown: "bg-purple-500",
  techdebt: "bg-red-500",
  "tech-debt": "bg-red-500",
  insight: "bg-blue-500",
  rating: "bg-slate-500",
};

export function ReviewQueue({ repoId, onFeatureClick }: Props) {
  const [items, setItems] = useState<PendingObservation[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const load = useCallback(() => {
    setItems(null);
    fetchPendingObservations(repoId ?? undefined)
      .then(setItems)
      .catch(() => setItems([]));
  }, [repoId]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (id: string, fn: (id: string) => Promise<unknown>) => {
    setBusyId(id);
    try {
      await fn(id);
      setItems((prev) => (prev ? prev.filter((o) => o.id !== id) : prev));
    } catch {
      // leave the item in place on failure
    } finally {
      setBusyId(null);
    }
  };

  const saveEdit = async (id: string) => {
    setBusyId(id);
    try {
      await editObservation(id, draft);
      setItems((prev) =>
        prev ? prev.map((o) => (o.id === id ? { ...o, summary: draft } : o)) : prev,
      );
      setEditingId(null);
    } catch {
      // keep editing on failure
    } finally {
      setBusyId(null);
    }
  };

  if (items === null) {
    return (
      <div className="max-w-2xl p-6 space-y-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Review Queue</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Pending observations reported by agents. Approve to promote into a feature's Current
            Understanding.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          Refresh
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
          <Inbox className="size-8" />
          <p className="text-sm">No pending observations. The brain is up to date.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((o) => {
            const kind = kindOf(o.category);
            const isEditing = editingId === o.id;
            const busy = busyId === o.id;
            return (
              <Card key={o.id} className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full ${KIND_COLORS[kind] ?? "bg-slate-400"}`}
                  />
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {kind || "observation"}
                  </span>
                  {o.feature_name ? (
                    <Badge
                      variant="outline"
                      className={onFeatureClick && o.feature_id ? "cursor-pointer hover:bg-accent" : ""}
                      onClick={() =>
                        onFeatureClick && o.feature_id && onFeatureClick(o.feature_id)
                      }
                    >
                      {o.feature_name}
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[10px]">
                      unresolved feature
                    </Badge>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {o.created_at ? new Date(o.created_at).toLocaleDateString() : ""}
                  </span>
                </div>

                {isEditing ? (
                  <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={3}
                    className="text-sm"
                  />
                ) : (
                  <p className="text-sm leading-relaxed">{o.summary}</p>
                )}

                <div className="flex items-center gap-2">
                  {isEditing ? (
                    <>
                      <Button size="sm" disabled={busy} onClick={() => saveEdit(o.id)}>
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => act(o.id, approveObservation)}
                      >
                        <Check className="size-3.5 mr-1" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => act(o.id, rejectObservation)}
                      >
                        <X className="size-3.5 mr-1" /> Reject
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          setEditingId(o.id);
                          setDraft(o.summary);
                        }}
                      >
                        <Pencil className="size-3.5 mr-1" /> Edit
                      </Button>
                    </>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
