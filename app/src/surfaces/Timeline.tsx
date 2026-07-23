import { useEffect, useState, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchTimeline, type TimelineData, type TimelineRow, type TimelineMark } from "../api";

/** The org in time — features as rows, derived marks (activity spans,
 *  check verdicts, sessions) on a rolling Gantt axis. No chart library;
 *  hand-rolled CSS grid + absolute positioning. Same JSON the brain serves agents.
 *
 *  Ruler H: the roadmap nobody updated — and it's true. Every mark is
 *  derived from activity_events, session_checks, and feature_sessions.
 *  Nothing is hand-authored. */
export function Timeline() {
  const [searchParams] = useSearchParams();
  const windowParam = searchParams.get("window") ?? "30d";
  const [data, setData] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<{ rowId: string; mark: TimelineMark } | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    fetchTimeline(windowParam)
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => { setData(null); setLoading(false); });
  }, [windowParam]);

  // Dismiss detail card on outside click.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target as Node)) {
        setSelected(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (loading) {
    return (
      <main className="ink-main">
        <div className="ink-empty" style={{ padding: "40px 32px", color: "var(--muted)" }}>
          Loading the org timeline…
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="ink-main">
        <div className="ink-empty" style={{ padding: "40px 32px" }}>
          <div className="big">Timeline unavailable</div>
          <div style={{ color: "var(--muted)", marginTop: "8px", fontSize: "13px" }}>
            The backend did not return timeline data. Check that Postgres is running.
          </div>
        </div>
      </main>
    );
  }

  const { window: win, rows, empty } = data;
  const since = new Date(win.since);
  const until = new Date(win.until);

  return (
    <main className="ink-main tl-main">
      {/* Header */}
      <div className="ink-main-head">
        <h1>Timeline</h1>
        <div className="sub">
          The org in time — {win.days} days, derived from real work. Nothing hand-authored.
        </div>
        <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
          {(["7d", "30d", "90d"] as const).map((w) => (
            <Link
              key={w}
              to={`/timeline?window=${w}`}
              className="tl-window-btn"
              data-active={windowParam === w ? "true" : undefined}
            >
              {w}
            </Link>
          ))}
        </div>
      </div>

      {empty ? (
        <div className="ink-empty" style={{ padding: "40px 32px" }}>
          <div className="big">No activity in this window</div>
          <div style={{ color: "var(--muted)", marginTop: "8px", fontSize: "13px" }}>
            No features had digested work in the last {win.days} days. Try a wider window.
          </div>
        </div>
      ) : (
        <div className="tl-gantt">
          <TlAxisHeader since={since} until={until} days={win.days} />
          {rows.map((row) => (
            <TlRow
              key={row.feature_id}
              row={row}
              since={since}
              until={until}
              selected={selected}
              onSelect={setSelected}
            />
          ))}
        </div>
      )}

      {/* Detail card — shown when a mark is selected */}
      {selected && (
        <div className="tl-detail-card" ref={tooltipRef}>
          <div className="tl-dc-kind" data-kind={selected.mark.kind}>
            {selected.mark.kind === "activity" ? "Activity" :
             selected.mark.kind === "check" ? "Check" : "Session"}
          </div>
          <div className="tl-dc-label">{selected.mark.label}</div>
          {selected.mark.detail && (
            <div className="tl-dc-detail">{selected.mark.detail}</div>
          )}
          <Link to={selected.mark.link} className="tl-dc-link" onClick={() => setSelected(null)}>
            Open →
          </Link>
        </div>
      )}
    </main>
  );
}

/** The time-axis header — date labels spread across the Gantt ruler. */
function TlAxisHeader({ since, until, days }: { since: Date; until: Date; days: number }) {
  // Show up to 6 evenly spaced date labels.
  const count = Math.min(days, 5);
  const labels: string[] = [];
  for (let i = 0; i <= count; i++) {
    const dt = new Date(since.getTime() + (until.getTime() - since.getTime()) * (i / count));
    labels.push(dt.toLocaleDateString("en-US", { month: "short", day: "numeric" }));
  }
  return (
    <div className="tl-axis">
      <div className="tl-label-col" />
      <div className="tl-ruler">
        {labels.map((l, i) => (
          <span key={i} className="tl-ruler-tick" style={{ left: `${(i / count) * 100}%` }}>
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

/** One feature row — feature name on the left, marks plotted on the Gantt track. */
function TlRow({
  row, since, until, selected, onSelect,
}: {
  row: TimelineRow;
  since: Date;
  until: Date;
  selected: { rowId: string; mark: TimelineMark } | null;
  onSelect: (sel: { rowId: string; mark: TimelineMark } | null) => void;
}) {
  const spanMs = until.getTime() - since.getTime();

  /** Convert an ISO timestamp to a percentage [0,100] across the window. */
  function pct(isoTs: string) {
    const t = new Date(isoTs).getTime();
    const p = (t - since.getTime()) / spanMs;
    return Math.max(0, Math.min(100, p * 100));
  }

  // Activity span bar: translucent stripe from first → last activity in window.
  const hasFull = row.first_activity && row.last_activity;
  const spanLeft = hasFull ? pct(row.first_activity!) : null;
  const spanRight = hasFull ? pct(row.last_activity!) : null;
  const spanWidth =
    spanLeft != null && spanRight != null ? Math.max(spanRight - spanLeft, 0.5) : 0;

  return (
    <div className="tl-row">
      <div className="tl-label-col">
        <Link to={`/feature/${row.feature_id}`} className="tl-feature-name">
          {row.feature_name}
        </Link>
        <div className="tl-repo-name">{row.repo}</div>
      </div>
      <div className="tl-track">
        {/* Activity span stripe */}
        {hasFull && spanLeft != null && (
          <div
            className="tl-span"
            style={{ left: `${spanLeft}%`, width: `${spanWidth}%` }}
          />
        )}
        {/* Marks as ink-coloured dots */}
        {row.marks.map((mark, i) => {
          if (!mark.ts) return null;
          const left = pct(mark.ts);
          const isSel = selected?.rowId === row.feature_id && selected.mark === mark;
          return (
            <button
              key={i}
              className="tl-mark"
              data-ink={mark.ink}
              data-kind={mark.kind}
              data-selected={isSel ? "true" : undefined}
              style={{ left: `${left}%` }}
              title={mark.label}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(isSel ? null : { rowId: row.feature_id, mark });
              }}
            >
              <span className="sr-only">{mark.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
