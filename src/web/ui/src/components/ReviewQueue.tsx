import { useState, useEffect, useCallback } from "react";
import {
  fetchPendingObservations,
  approveObservation,
  rejectObservation,
  editObservation,
} from "../api";
import type { PendingObservation } from "../types";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  repoId: string | null;
  /** Click-through to the feature an observation is attached to. */
  onFeatureClick?: (featureId: string) => void;
}

/** The `<kind>` part of an `observation:<kind>` category. */
function kindOf(category: string): string {
  return category.startsWith("observation:") ? category.slice("observation:".length) : category;
}

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
      <div className="mx-auto max-w-2xl px-8 py-12">
        <div className="ink-kicker">The gate</div>
        <Skeleton className="mt-3 h-8 w-40" />
        <Skeleton className="mt-6 h-24 w-full" />
      </div>
    );
  }

  const minutes = Math.max(1, Math.round(items.length * 0.5));

  return (
    <div className="mx-auto max-w-2xl px-8 pb-24 pt-12">
      <header>
        <div className="ink-rise flex items-baseline justify-between" style={{ "--i": 0 } as React.CSSProperties}>
          <span className="ink-kicker">The gate — what the Brain wants to learn</span>
          <button className="ink-stamp ink-stamp--quiet" onClick={load}>Refresh</button>
        </div>
        <h1 className="ink-masthead ink-rise mt-2" style={{ "--i": 1 } as React.CSSProperties}>Review</h1>
        <div className="ink-rule-double ink-rise mt-4" style={{ "--i": 1 } as React.CSSProperties} />
        <p className="ink-deck ink-rise mt-4" style={{ "--i": 2 } as React.CSSProperties}>
          {items.length > 0 ? (
            <>
              <span className="j-fig" style={{ fontStyle: "normal", fontWeight: 600, color: "var(--j-red)" }}>{items.length}</span>{" "}
              observation{items.length === 1 ? "" : "s"} await your judgment — about {minutes} minute{minutes === 1 ? "" : "s"}.
              Approving teaches; whatever you approve is served to every agent that enters the feature.
            </>
          ) : (
            <>The Brain is current — every observation has been judged. Come back after the next session.</>
          )}
        </p>
      </header>

      <div className="mt-8 space-y-4">
        {items.map((o, i) => {
          const kind = kindOf(o.category);
          const isEditing = editingId === o.id;
          const busy = busyId === o.id;
          return (
            <div key={o.id} className="ink-note ink-rise" style={{ "--i": i + 3 } as React.CSSProperties}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="ink-note-label">{kind || "observation"} · awaiting review</span>
                <span className="ml-auto ink-ledger-meta">
                  {o.actor ? `${o.actor} · ` : ""}
                  {o.created_at
                    ? new Date(o.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                    : ""}
                </span>
              </div>

              {isEditing ? (
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={3}
                  className="mt-2 text-sm"
                  style={{ fontFamily: "var(--j-serif)", fontStyle: "italic" }}
                />
              ) : (
                <p className="ink-note-text">{o.summary}</p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {isEditing ? (
                  <>
                    <button className="ink-stamp ink-stamp--approve" disabled={busy} onClick={() => saveEdit(o.id)}>
                      Save
                    </button>
                    <button className="ink-stamp ink-stamp--quiet" disabled={busy} onClick={() => setEditingId(null)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button className="ink-stamp ink-stamp--approve" disabled={busy} onClick={() => act(o.id, approveObservation)}>
                      Approve
                    </button>
                    <button className="ink-stamp ink-stamp--reject" disabled={busy} onClick={() => act(o.id, rejectObservation)}>
                      Reject
                    </button>
                    <button
                      className="ink-stamp ink-stamp--quiet"
                      disabled={busy}
                      onClick={() => {
                        setEditingId(o.id);
                        setDraft(o.summary);
                      }}
                    >
                      Edit
                    </button>
                  </>
                )}
                {o.feature_name ? (
                  <button
                    className="ink-tag ml-auto"
                    onClick={() => onFeatureClick && o.feature_id && onFeatureClick(o.feature_id)}
                  >
                    {o.feature_name}
                  </button>
                ) : (
                  <span className="ink-tag ink-tag--red ml-auto">unresolved feature</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
