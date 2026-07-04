import { useEffect, useState } from "react";
import type { Session, ArchiveResponse, StatsOverview, SessionQuality } from "../types";
import { fetchArchive, fetchStatsOverview } from "../api";
import type { LiveState } from "../api";
import { ProvenanceChip } from "./Quality";
import { RefreshCw, Archive } from "lucide-react";

interface Props {
  repoId: string | null;
  sessions: Session[];
  undigestedCount: number;
  liveState: LiveState | null;
  onSync: () => void;
  onSessionClick: (id: string) => void;
}

/** "5.7 MB" / "156 KB" — archive files are big; keep the figure readable. */
function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function SessionsPage({ repoId, sessions, undigestedCount, liveState, onSync, onSessionClick }: Props) {
  const [archive, setArchive] = useState<ArchiveResponse | null>(null);
  const [stats, setStats] = useState<StatsOverview | null>(null);

  useEffect(() => {
    fetchArchive().then(setArchive).catch(() => setArchive(null));
  }, []);

  // provenance quality per session — the altitude layer (fail-safe chrome)
  useEffect(() => {
    fetchStatsOverview(repoId ?? undefined).then(setStats).catch(() => setStats(null));
  }, [repoId]);

  const qualityBySession = new Map<string, SessionQuality>(
    (stats?.sessions ?? []).map((q) => [q.sessionId, q]),
  );
  const record = stats?.record ?? null;
  const sorted = [...sessions].sort((a, b) => {
    const da = a.started_at ? new Date(a.started_at).getTime() : 0;
    const db = b.started_at ? new Date(b.started_at).getTime() : 0;
    return db - da;
  });

  const formatDate = (d: string | null) => {
    if (!d) return "";
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return (
    <div className="mx-auto max-w-2xl px-8 pb-24 pt-12">
      <header>
        <div className="ink-rise flex items-baseline justify-between" style={{ "--i": 0 } as React.CSSProperties}>
          <span className="ink-kicker">The record — every session, digested</span>
          {undigestedCount > 0 && (
            <button className="ink-stamp ink-stamp--approve inline-flex items-center gap-1.5" onClick={onSync}>
              <RefreshCw className="size-3" /> Digest {undigestedCount} new
            </button>
          )}
        </div>
        <h1 className="ink-masthead ink-rise mt-2" style={{ "--i": 1 } as React.CSSProperties}>Sessions</h1>
        <div className="ink-rule-double ink-rise mt-4" style={{ "--i": 1 } as React.CSSProperties} />
        <p className="ink-deck ink-rise mt-4" style={{ "--i": 2 } as React.CSSProperties}>
          <span style={{ fontStyle: "normal", fontWeight: 600, color: "var(--j-ink)" }}>{sessions.length}</span>{" "}
          session{sessions.length === 1 ? "" : "s"} digested
          {record?.anchoredPct != null && (
            <>
              {"; evidence "}
              <span
                style={{ fontStyle: "normal", fontWeight: 600, color: "var(--j-ink)" }}
                title={`${record.anchored} of ${record.quotes} evidence quotes anchored to their transcripts`}
              >
                {record.anchoredPct}% anchored
              </span>
              {" across the record"}
            </>
          )}
          {undigestedCount > 0 && (
            <>
              {"; "}
              <span style={{ color: "var(--j-red)" }}>
                {undigestedCount} waiting to be read
              </span>
            </>
          )}
          .
        </p>
      </header>

      {sorted.length === 0 ? (
        <div className="ink-rise mt-16 text-center" style={{ "--i": 3 } as React.CSSProperties}>
          <p className="ink-deck">No digested sessions yet.</p>
        </div>
      ) : (
        <div className="ink-ledger mt-8">
          {liveState?.state && (
            <button className="ink-ledger-row" onClick={() => onSessionClick("live")}>
              <span className="relative flex size-2.5 shrink-0 self-center">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: "var(--j-moss)" }} />
                <span className="relative inline-flex size-2.5 rounded-full" style={{ background: "var(--j-moss)" }} />
              </span>
              <span className="ink-ledger-title min-w-0 flex-1" style={{ fontSize: "0.98rem" }}>
                {liveState.state.currentIntent || "Active session"}
              </span>
              <span className="ink-tag ink-tag--moss">live · {liveState.state.turnCount} turns</span>
            </button>
          )}
          {sorted.map((s, i) => (
            <button
              key={s.id}
              className="ink-ledger-row ink-rise"
              style={{ "--i": i + 3 } as React.CSSProperties}
              onClick={() => onSessionClick(s.id)}
              data-talk
              data-talk-kind="session"
              data-talk-id={s.id}
              data-talk-label={`session · ${formatDate(s.started_at) || s.id.slice(0, 8)}`}
              data-talk-summary={s.narrative_summary?.split(/[.!?\n]/)[0] || undefined}
            >
              <span className="ink-ledger-meta w-12 shrink-0">{formatDate(s.started_at)}</span>
              <span className="min-w-0 flex-1">
                <span className="ink-ledger-title" style={{ fontSize: "0.98rem" }}>
                  {s.narrative_summary?.split(/[.!?\n]/)[0] || "No narrative"}
                </span>
              </span>
              <span className="flex items-center gap-2.5">
                {s.session_shape && <span className="ink-tag">{s.session_shape}</span>}
                <span className="ink-ledger-meta">{s.moment_count} moments</span>
                {(() => {
                  const q = qualityBySession.get(s.id);
                  return q ? <ProvenanceChip pct={q.anchoredPct} quotes={q.quotes} anchored={q.anchored} /> : null;
                })()}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* The archive — raw evidence preserved on disk (.intent/raw-sessions).
          Digestion copies every log here so evidence outlives Claude Code's
          ~30-day purge and every digest stays re-derivable. */}
      {archive && archive.entries.length > 0 && (
        <section className="ink-rise mt-14" style={{ "--i": 5 } as React.CSSProperties}>
          <h3 className="ink-section">
            <Archive className="mr-1 inline size-3" />
            The archive — {archive.entries.length} raw session{archive.entries.length === 1 ? "" : "s"} preserved
          </h3>
          <p className="ink-chrome mt-3 italic">
            Raw logs kept in <code>.intent/raw-sessions/</code> — evidence outlives the ~30-day purge;
            every digest stays re-derivable.
            {!archive.dbAvailable && " (The sessions table is unreachable — digested state unknown.)"}
          </p>
          <div className="ink-ledger mt-4">
            {archive.entries.map((e) => {
              const clickable = e.digested && e.sessionId;
              return (
                <button
                  key={e.hash}
                  className="ink-ledger-row"
                  style={clickable ? undefined : { cursor: "default" }}
                  onClick={() => { if (clickable) onSessionClick(e.sessionId as string); }}
                  title={e.file}
                >
                  <span className="ink-ledger-meta w-20 shrink-0" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {e.hash.slice(0, 8)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="ink-ledger-meta">
                      {formatSize(e.sizeBytes)} · touched{" "}
                      {new Date(e.lastModified).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  </span>
                  {archive.dbAvailable ? (
                    e.digested ? (
                      <span className="ink-tag ink-tag--moss">digested</span>
                    ) : (
                      <span className="ink-tag ink-tag--red">undigested</span>
                    )
                  ) : (
                    <span className="ink-tag">unknown</span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
