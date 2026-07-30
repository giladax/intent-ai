// The altitude layer — quality affordances in the ink language.
// Data as ornament: provenance rings (anchored evidence), the fortnight
// strip (event cadence), momentum marks (feature motion). Every figure is
// real; nothing celebrates, everything reports.
import { useEffect, useState } from "react";
import type { CadenceDay, CadenceSummary, MomentumTrend } from "../types";
import { toneOfPct, sparkHeights, cadenceCaption, type QualityTone } from "./quality-util";

const TONE_COLOR: Record<QualityTone, string> = {
  high: "var(--j-moss)",
  mid: "var(--j-ink-soft)",
  low: "var(--j-red)",
  none: "var(--j-faint)",
};

// ── Provenance ring — how much of the digest is pinned to the transcript ──

export function ProvenanceRing({
  pct,
  size = 16,
  title,
}: {
  /** 0–100 anchored share; null renders a dotted "unknown" ring. */
  pct: number | null;
  size?: number;
  title?: string;
}) {
  // Draw the arc in after mount — one quiet reveal, no looping motion.
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const stroke = 2;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const tone = toneOfPct(pct);
  const share = pct === null ? 0 : Math.max(0, Math.min(100, pct)) / 100;

  return (
    <svg
      className="ink-ring"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={title ?? (pct === null ? "no evidence" : `${pct}% anchored`)}
    >
      {title && <title>{title}</title>}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--j-hairline)"
        strokeWidth={stroke}
        strokeDasharray={pct === null ? "1.5 3" : undefined}
      />
      {pct !== null && (
        <circle
          className="ink-ring-arc"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={TONE_COLOR[tone]}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={drawn ? c * (1 - share) : c}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      )}
    </svg>
  );
}

/** Ring + mono percent figure, for ledger rows. */
export function ProvenanceChip({ pct, quotes, anchored }: { pct: number | null; quotes: number; anchored: number }) {
  if (pct === null) return null;
  const title = `${anchored} of ${quotes} evidence quotes anchored to the transcript`;
  return (
    <span className="ink-provenance" title={title}>
      <ProvenanceRing pct={pct} title={title} />
      <span className="ink-provenance-fig" style={{ color: TONE_COLOR[toneOfPct(pct)] }}>
        {pct}%
      </span>
    </span>
  );
}

// ── The fortnight strip — cadence as a row of ink bars ────────────────

export function FortnightStrip({
  cadence,
  summary,
  label = "the fortnight",
}: {
  cadence: CadenceDay[];
  summary: CadenceSummary;
  label?: string;
}) {
  if (cadence.length === 0) return null;
  const heights = sparkHeights(cadence, 22);
  const fmt = (d: string) =>
    new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return (
    <div className="ink-fortnight" role="img" aria-label={`${label}: ${cadenceCaption(summary.totalEvents, summary.activeDays, summary.streak)}`}>
      <div className="ink-fortnight-bars">
        {cadence.map((d, i) => (
          <span
            key={d.day}
            className="ink-fortnight-bar"
            data-zero={d.events === 0}
            style={{ height: `${Math.max(heights[i], 2)}px`, animationDelay: `${i * 28}ms` }}
            title={`${fmt(d.day)} — ${d.events} event${d.events === 1 ? "" : "s"}`}
          />
        ))}
      </div>
      <span className="ink-fortnight-caption">
        {label} — {summary.totalEvents} event{summary.totalEvents === 1 ? "" : "s"} ·{" "}
        {summary.activeDays} active day{summary.activeDays === 1 ? "" : "s"}
        {summary.streak >= 2 && (
          <>
            {" · "}
            {/* a streak of 3+ earns its warmth — gold ink, a quiet kindle */}
            <span className={summary.streak >= 3 ? "ink-streak--warm" : undefined}>
              streak {summary.streak}
              {summary.streak >= 3 && <span aria-hidden="true"> ✦</span>}
            </span>
          </>
        )}
      </span>
    </div>
  );
}

// ── Momentum mark — a feature's motion, one glyph ─────────────────────

const TREND_GLYPH: Record<MomentumTrend, string> = {
  rising: "↗",
  steady: "→",
  cooling: "↘",
  quiet: "·",
};

const TREND_COLOR: Record<MomentumTrend, string> = {
  rising: "var(--j-moss)",
  steady: "var(--j-ink-soft)",
  cooling: "var(--j-faint)",
  quiet: "var(--j-faint)",
};

export function MomentumMark({ trend, detail }: { trend: MomentumTrend; detail?: string | null }) {
  if (trend === "quiet") return null; // silence stays silent
  return (
    <span className="ink-momentum" style={{ color: TREND_COLOR[trend] }} title={detail ?? undefined}>
      <span aria-hidden="true">{TREND_GLYPH[trend]}</span> {trend}
    </span>
  );
}
