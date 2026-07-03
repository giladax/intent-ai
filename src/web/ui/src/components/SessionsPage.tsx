import type { Session } from "../types";
import type { LiveState } from "../api";
import { RefreshCw } from "lucide-react";

interface Props {
  sessions: Session[];
  undigestedCount: number;
  liveState: LiveState | null;
  onSync: () => void;
  onSessionClick: (id: string) => void;
}

export function SessionsPage({ sessions, undigestedCount, liveState, onSync, onSessionClick }: Props) {
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
            >
              <span className="ink-ledger-meta w-12 shrink-0">{formatDate(s.started_at)}</span>
              <span className="min-w-0 flex-1">
                <span className="ink-ledger-title" style={{ fontSize: "0.98rem" }}>
                  {s.narrative_summary?.split(/[.!?\n]/)[0] || "No narrative"}
                </span>
              </span>
              <span className="flex items-center gap-2">
                {s.session_shape && <span className="ink-tag">{s.session_shape}</span>}
                <span className="ink-ledger-meta">{s.moment_count} moments</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
