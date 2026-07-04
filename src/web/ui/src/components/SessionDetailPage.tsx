// The record, read closely — one digested session in the ink language:
// masthead header, moments as a ledger of glyphs, the narrative as the deck.
// The event stream keeps its chunk-window hints (digestion inspection).
import { useState, useEffect, useCallback } from "react";
import { fetchSessionDetail, fetchSessionEventsWithWindows, fetchStatsOverview } from "../api";
import type { SessionDetail, SessionEventsWithWindows, EventWithWindows, EventWindow, SessionSitting, SessionQuality } from "../types";
import { Skeleton } from "@/components/ui/skeleton";
import { ProvenanceRing } from "./Quality";
import { ProvenanceWhy, ProvenanceDrawer } from "./ProvenancePanel";
import { momentTone } from "./journal-util";
import { ArrowLeft } from "lucide-react";

interface Props {
  sessionId: string;
  /** Back to the record (the sessions ledger). */
  onBack?: () => void;
}

/** Moment-type glyphs — the beat vocabulary; tones come from momentTone. */
const MOMENT_GLYPH: Record<string, string> = {
  discovery: "✦",
  decision: "◆",
  commitment: "◆",
  implementation: "·",
  struggle: "⚠",
  realization: "✦",
  refactor: "↻",
  pivot: "→",
  proposal: "◇",
  confirmation: "✓",
  rejection: "✕",
  transition: "→",
};

/* chunk windows cycle through the inkwell — same six inks as everywhere */
const CHUNK_TONES = ["consult", "moss", "gold", "violet", "teal", "red"] as const;
function chunkColor(index: number) {
  const tone = CHUNK_TONES[index % CHUNK_TONES.length];
  return {
    border: `var(--j-${tone})`,
    bg: `var(--j-${tone}-soft)`,
    badge: `var(--j-${tone})`,
  };
}

// ── Moment row — a ledger line that can explain itself ────────────────
function MomentRow({ m, onJump }: { m: any; onJump: (causalOrder: number) => void }) {
  const [provOpen, setProvOpen] = useState(false);
  const tone = momentTone(m.type);
  return (
    <div className="flex gap-3 border-b py-3" style={{ borderColor: "var(--j-hairline)" }}>
      <span
        className="w-4 shrink-0 pt-0.5 text-center"
        style={{
          fontFamily: "var(--j-mono)",
          fontSize: "0.75rem",
          color: tone ? `var(--j-${tone})` : "var(--j-faint)",
        }}
      >
        {MOMENT_GLYPH[m.type] ?? "·"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={tone ? `ink-tag ink-tag--${tone}` : "ink-tag"}>{m.type || "moment"}</span>
          {m.agency && <span className="ink-ledger-meta">{m.agency}</span>}
          {m.confidence && <span className="ink-ledger-meta">{m.confidence}</span>}
          <ProvenanceWhy open={provOpen} onClick={() => setProvOpen((v) => !v)} />
        </div>
        <p
          className="mt-1.5"
          style={{ fontFamily: "var(--j-serif)", fontSize: "0.98rem", lineHeight: 1.55, color: "var(--j-ink)", margin: 0, marginTop: "0.35rem" }}
        >
          {m.statement}
        </p>
        {m.significance && <p className="ink-ledger-sub mt-1">{m.significance}</p>}
        {m.id && <ProvenanceDrawer eventId={m.id} open={provOpen} onJump={onJump} />}
      </div>
    </div>
  );
}

function formatGap(prev: SessionSitting, curr: SessionSitting): string {
  const ms = new Date(curr.startedAt).getTime() - new Date(prev.endedAt).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`;
  return `${(ms / 86_400_000).toFixed(1)}d`;
}

export function SessionDetailPage({ sessionId, onBack }: Props) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [eventsWithWindows, setEventsWithWindows] = useState<SessionEventsWithWindows | null>(null);
  const [quality, setQuality] = useState<SessionQuality | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchSessionDetail(sessionId)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
    fetchSessionEventsWithWindows(sessionId)
      .then(setEventsWithWindows)
      .catch(() => setEventsWithWindows(null));
    // digest fidelity — provenance quality for this session (fail-safe chrome)
    fetchStatsOverview()
      .then((s) => setQuality(s.sessions.find((q) => q.sessionId === sessionId) ?? null))
      .catch(() => setQuality(null));
  }, [sessionId]);

  // An evidence anchor answers with a jump: scroll the transcript event into
  // view and flash it in the river's teal.
  const jumpToEvent = useCallback((causalOrder: number) => {
    const el = document.getElementById(`evt-${causalOrder}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("prov-flash");
    void el.offsetWidth; // restart the animation
    el.classList.add("prov-flash");
  }, []);

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-8 py-12">
        <div className="ink-kicker">The record — one session, read closely</div>
        <Skeleton className="mt-3 h-8 w-48" />
        <Skeleton className="mt-6 h-20 w-full" />
        <Skeleton className="mt-3 h-20 w-full" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="ink-deck">This session isn&rsquo;t in the record.</p>
      </div>
    );
  }

  const { session, narrative, moments, transitions } = detail;
  const startedAt = session?.started_at ?? null;
  const shape = session?.session_shape ?? narrative?.sessionShape ?? null;

  const formatDate = (d: string | null) => {
    if (!d) return "";
    return new Date(d).toLocaleDateString("en-US", {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  };

  return (
    <div className="mx-auto max-w-2xl px-8 pb-24 pt-12">
      {/* masthead */}
      <header>
        <div className="ink-rise flex items-baseline justify-between gap-4" style={{ "--i": 0 } as React.CSSProperties}>
          <span className="ink-kicker">The record — one session, read closely</span>
          {onBack && (
            <button className="ink-stamp ink-stamp--quiet inline-flex items-center gap-1" onClick={onBack}>
              <ArrowLeft className="size-3" /> All sessions
            </button>
          )}
        </div>
        <div className="ink-rise mt-2 flex items-baseline gap-3" style={{ "--i": 1 } as React.CSSProperties}>
          <h1 className="ink-masthead">{formatDate(startedAt) || "Session"}</h1>
          {shape && <span className="ink-tag">{shape}</span>}
        </div>
        <div className="ink-rule-double ink-rise mt-4" style={{ "--i": 1 } as React.CSSProperties} />
        {narrative?.summary && (
          <p className="ink-deck ink-rise mt-4" style={{ "--i": 2 } as React.CSSProperties}>{narrative.summary}</p>
        )}

        {/* digest fidelity — how firmly this digest is pinned to its transcript */}
        {quality && quality.quotes > 0 && (
          <div className="ink-fidelity ink-rise mt-5" style={{ "--i": 2 } as React.CSSProperties}>
            <span className="ink-fidelity-item" title={`${quality.anchored} of ${quality.quotes} evidence quotes anchored to the transcript`}>
              <ProvenanceRing pct={quality.anchoredPct} size={15} />
              <span className="ink-fig">{quality.anchoredPct}%</span> anchored · {quality.anchored}/{quality.quotes} quotes
            </span>
            {quality.supported > 0 && (
              <span className="ink-fidelity-item" data-tone="moss" title="Moments the understanding pass verified as supported by the code">
                <span className="ink-fig">{quality.supported}</span> supported
              </span>
            )}
            {quality.contradicted > 0 && (
              <span className="ink-fidelity-item" data-tone="red" title="Moments the understanding pass found contradicted — read these closely">
                <span className="ink-fig">{quality.contradicted}</span> contradicted
              </span>
            )}
            <span className="ink-fidelity-item" title="Moments extracted from this session">
              <span className="ink-fig">{quality.moments}</span> moments
            </span>
          </div>
        )}
      </header>

      {/* Moments — what the digestion judged significant */}
      {moments && moments.length > 0 && (
        <section className="ink-rise mt-10" style={{ "--i": 3 } as React.CSSProperties}>
          <h3 className="ink-section">{moments.length} moment{moments.length === 1 ? "" : "s"}</h3>
          <div className="mt-4">
            {moments.map((m: any, i: number) => (
              <MomentRow key={m.id || i} m={m} onJump={jumpToEvent} />
            ))}
          </div>
        </section>
      )}

      {/* Transitions — where the session changed direction */}
      {transitions && transitions.length > 0 && (
        <section className="ink-rise mt-10" style={{ "--i": 4 } as React.CSSProperties}>
          <h3 className="ink-section">Transitions</h3>
          <div className="mt-4 space-y-3">
            {transitions.map((t: any, i: number) => (
              <div key={i} className="ink-note ink-note--plain">
                <div className="ink-note-label">turn</div>
                <p className="ink-note-text">{t.description || t.summary || JSON.stringify(t)}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Event stream with chunk-window hints — how digestion read the transcript */}
      {eventsWithWindows && eventsWithWindows.events.length > 0 && (
        <section className="ink-rise mt-10" style={{ "--i": 5 } as React.CSSProperties}>
          <h3 className="ink-section">Event stream — {eventsWithWindows.events.length} events</h3>
          <div className="mt-4">
            {eventsWithWindows.events.map((event: EventWithWindows) => {
              // Determine sitting separator
              const sittingIdx = eventsWithWindows.sittings.findIndex(
                (s: SessionSitting) => s.eventRangeStart === event.causalOrder && s.sittingIndex > 0,
              );
              const sitting = sittingIdx >= 0 ? eventsWithWindows.sittings[sittingIdx] : null;
              const prevSitting = sitting ? eventsWithWindows.sittings[sittingIdx - 1] : null;

              // Determine primary chunk color (first window)
              const primaryChunkIndex = event.windows[0] ?? 0;
              const chunk = chunkColor(primaryChunkIndex);

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

                  {/* Event row — an anchor target for provenance jumps */}
                  <div
                    id={`evt-${event.causalOrder}`}
                    style={{
                      borderLeft: `3px solid ${chunk.border}`,
                      background: isOverlap ? chunk.bg : undefined,
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
                            color: chunk.badge,
                            border: `1px solid ${chunk.border}`,
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
                            color: chunk.badge,
                            border: `1px solid ${chunk.border}`,
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
        </section>
      )}
    </div>
  );
}
