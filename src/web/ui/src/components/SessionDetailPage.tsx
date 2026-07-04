import { useState, useEffect } from "react";
import { fetchSessionDetail, fetchSessionEventsWithWindows } from "../api";
import type { SessionDetail, SessionEventsWithWindows, EventWithWindows, EventWindow, SessionSitting } from "../types";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  sessionId: string;
}

const MOMENT_COLORS: Record<string, string> = {
  discovery: "bg-emerald-500",
  decision: "bg-blue-500",
  commitment: "bg-indigo-500",
  implementation: "bg-purple-500",
  struggle: "bg-amber-500",
  realization: "bg-cyan-500",
  refactor: "bg-orange-500",
  pivot: "bg-red-500",
  proposal: "bg-teal-500",
  confirmation: "bg-green-500",
  rejection: "bg-rose-500",
  transition: "bg-violet-500",
};

const CHUNK_COLORS = [
  { border: "#6366f1", bg: "#6366f115", badge: "#6366f1" },
  { border: "#10b981", bg: "#10b98115", badge: "#10b981" },
  { border: "#f59e0b", bg: "#f59e0b15", badge: "#f59e0b" },
  { border: "#ef4444", bg: "#ef444415", badge: "#ef4444" },
  { border: "#8b5cf6", bg: "#8b5cf615", badge: "#8b5cf6" },
  { border: "#06b6d4", bg: "#06b6d415", badge: "#06b6d4" },
];

function formatGap(prev: SessionSitting, curr: SessionSitting): string {
  const ms = new Date(curr.startedAt).getTime() - new Date(prev.endedAt).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`;
  return `${(ms / 86_400_000).toFixed(1)}d`;
}

export function SessionDetailPage({ sessionId }: Props) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [eventsWithWindows, setEventsWithWindows] = useState<SessionEventsWithWindows | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchSessionDetail(sessionId)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
    fetchSessionEventsWithWindows(sessionId)
      .then(setEventsWithWindows)
      .catch(() => setEventsWithWindows(null));
  }, [sessionId]);

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Session not found
      </div>
    );
  }

  const { narrative, moments, transitions } = detail;

  const formatDate = (d: string | null) => {
    if (!d) return "";
    return new Date(d).toLocaleDateString("en-US", {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">{formatDate(narrative?.started_at ?? null) || "Session"}</h2>
          {narrative?.session_shape && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{narrative.session_shape}</Badge>
          )}
        </div>
      </div>

      {/* Narrative */}
      {narrative?.summary && (
        <Card className="p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Narrative</h3>
          <p className="text-sm leading-relaxed">{narrative.summary}</p>
        </Card>
      )}

      {/* Moments */}
      {moments && moments.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {moments.length} Moments
          </h3>
          <div className="space-y-2">
            {moments.map((m: any, i: number) => (
              <div key={m.id || i} className="flex gap-3 group">
                {/* Timeline dot */}
                <div className="flex flex-col items-center pt-1.5">
                  <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${MOMENT_COLORS[m.type] || "bg-muted-foreground"}`} />
                  {i < moments.length - 1 && <div className="w-px flex-1 bg-border mt-1" />}
                </div>
                {/* Content */}
                <div className="flex-1 pb-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">{m.type || "moment"}</Badge>
                    {m.agency && (
                      <span className="text-[10px] text-muted-foreground">{m.agency}</span>
                    )}
                    {m.confidence && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{m.confidence}</Badge>
                    )}
                  </div>
                  <p className="text-sm leading-relaxed">{m.statement}</p>
                  {m.significance && (
                    <p className="text-xs text-muted-foreground mt-1">{m.significance}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Transitions */}
      {transitions && transitions.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Transitions</h3>
          {transitions.map((t: any, i: number) => (
            <Card key={i} className="p-3">
              <p className="text-sm">{t.description || t.summary || JSON.stringify(t)}</p>
            </Card>
          ))}
        </div>
      )}

      {/* Event Stream with window hints */}
      {eventsWithWindows && eventsWithWindows.events.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Event Stream · {eventsWithWindows.events.length} events
          </h3>
          <div>
            {eventsWithWindows.events.map((event: EventWithWindows) => {
              // Determine sitting separator
              const sittingIdx = eventsWithWindows.sittings.findIndex(
                (s: SessionSitting) => s.eventRangeStart === event.causalOrder && s.sittingIndex > 0,
              );
              const sitting = sittingIdx >= 0 ? eventsWithWindows.sittings[sittingIdx] : null;
              const prevSitting = sitting ? eventsWithWindows.sittings[sittingIdx - 1] : null;

              // Determine primary chunk color (first window)
              const primaryChunkIndex = event.windows[0] ?? 0;
              const chunkColor = CHUNK_COLORS[primaryChunkIndex % CHUNK_COLORS.length];

              // Find chunk metadata for topic hint
              const chunkMeta: EventWindow | undefined = eventsWithWindows.chunks.find(
                (c: EventWindow) => c.chunkIndex === primaryChunkIndex,
              );

              const isOverlap = event.windows.length > 1;

              return (
                <div key={event.id}>
                  {/* Sitting separator */}
                  {sitting && prevSitting && (
                    <div className="ink-section my-3" style={{ color: "var(--j-faint)" }}>
                      sitting {sitting.sittingIndex + 1} · after {formatGap(prevSitting, sitting)} gap
                    </div>
                  )}

                  {/* Event row */}
                  <div
                    style={{
                      borderLeft: `3px solid ${chunkColor.border}`,
                      background: isOverlap ? chunkColor.bg : undefined,
                      paddingLeft: "0.75rem",
                      paddingTop: "0.35rem",
                      paddingBottom: "0.35rem",
                      marginBottom: "2px",
                    }}
                  >
                    {/* Meta row */}
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.2rem", flexWrap: "wrap" }}>
                      {/* Chunk badge(s) */}
                      {isOverlap ? (
                        <span
                          style={{
                            fontFamily: "var(--j-mono)",
                            fontSize: "0.575rem",
                            letterSpacing: "0.04em",
                            color: chunkColor.badge,
                            border: `1px solid ${chunkColor.border}`,
                            borderRadius: "3px",
                            padding: "0 4px",
                            whiteSpace: "nowrap",
                          }}
                        >
                          c{event.windows[0]}·c{event.windows[1]} — overlap
                        </span>
                      ) : (
                        <span
                          style={{
                            fontFamily: "var(--j-mono)",
                            fontSize: "0.575rem",
                            letterSpacing: "0.04em",
                            color: chunkColor.badge,
                            border: `1px solid ${chunkColor.border}`,
                            borderRadius: "3px",
                            padding: "0 4px",
                          }}
                        >
                          c{primaryChunkIndex}
                        </span>
                      )}
                      {/* Category badge */}
                      <span
                        style={{
                          fontFamily: "var(--j-mono)",
                          fontSize: "0.575rem",
                          letterSpacing: "0.04em",
                          background: "var(--j-wash)",
                          color: "var(--j-ink-soft)",
                          borderRadius: "3px",
                          padding: "0 4px",
                        }}
                      >
                        {event.category}
                      </span>
                      {/* Actor + causal order */}
                      <span
                        style={{
                          fontFamily: "var(--j-mono)",
                          fontSize: "0.575rem",
                          color: "var(--j-faint)",
                        }}
                      >
                        {event.actor} · #{event.causalOrder}
                      </span>
                      {/* Topic hint */}
                      {chunkMeta?.topicHint && (
                        <span
                          style={{
                            fontFamily: "var(--j-mono)",
                            fontSize: "0.575rem",
                            color: "var(--j-faint)",
                            maxWidth: "200px",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={chunkMeta.topicHint}
                        >
                          {chunkMeta.topicHint}
                        </span>
                      )}
                    </div>
                    {/* Summary */}
                    <p
                      style={{
                        fontFamily: "var(--j-serif)",
                        fontSize: "0.9rem",
                        lineHeight: "1.5",
                        color: "var(--j-ink)",
                        margin: 0,
                      }}
                    >
                      {event.summary}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
