import { useState, useEffect, useCallback, useRef } from "react";
import confetti from "canvas-confetti";
import {
  fetchPendingObservations,
  approveObservation,
  rejectObservation,
  editObservation,
} from "../api";
import type { PendingObservation } from "../types";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";

/** Ink flecks, not party confetti — the queue-cleared flourish. */
function inkFlourish() {
  confetti({
    particleCount: 45,
    spread: 75,
    startVelocity: 28,
    gravity: 0.9,
    scalar: 0.7,
    ticks: 120,
    origin: { x: 0.5, y: 0.25 },
    colors: ["#3d3a33", "#b8452e", "#5a7d5a", "#8a867c"],
    disableForReducedMotion: true,
  });
}

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
  // id → verdict while the stamp lands and the note slides out
  const [stamped, setStamped] = useState<Map<string, "taught" | "dismissed">>(new Map());
  const hadItemsRef = useRef(false);

  const load = useCallback(() => {
    setItems(null);
    fetchPendingObservations(repoId ?? undefined)
      .then(setItems)
      .catch(() => setItems([]));
  }, [repoId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (items && items.length > 0) hadItemsRef.current = true;
  }, [items]);

  const act = async (id: string, fn: (id: string) => Promise<unknown>, verdict: "taught" | "dismissed") => {
    setBusyId(id);
    try {
      await fn(id);
      // the stamp lands, the note lingers a beat, then slides off the desk
      setStamped((prev) => new Map(prev).set(id, verdict));
      setTimeout(() => {
        setItems((prev) => {
          const next = prev ? prev.filter((o) => o.id !== id) : prev;
          if (hadItemsRef.current && next && next.length === 0) inkFlourish();
          return next;
        });
        setStamped((prev) => {
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
      }, 950);
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
          <span className="ink-kicker">The gate — what Quire wants to learn</span>
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
            <>Quire is current — every observation has been judged. Come back after the next session.</>
          )}
        </p>
      </header>

      <div className="mt-8 space-y-4">
        {items.map((o, i) => {
          const kind = kindOf(o.category);
          const isEditing = editingId === o.id;
          const busy = busyId === o.id;
          const verdict = stamped.get(o.id);
          return (
            <div
              key={o.id}
              className={`ink-note ink-rise relative ${verdict ? "ink-note--leaving" : ""}`}
              style={{ "--i": i + 3 } as React.CSSProperties}
              data-talk
              data-talk-kind="observation"
              data-talk-id={o.id}
              data-talk-label={kind || "observation"}
              data-talk-summary={o.summary}
            >
              {verdict && (
                <span className={`ink-stamp-verdict ink-stamp-verdict--${verdict}`}>
                  {verdict}
                </span>
              )}
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
                    <button className="ink-stamp ink-stamp--approve" disabled={busy || !!verdict} onClick={() => act(o.id, approveObservation, "taught")}>
                      Approve
                    </button>
                    <button className="ink-stamp ink-stamp--reject" disabled={busy || !!verdict} onClick={() => act(o.id, rejectObservation, "dismissed")}>
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
