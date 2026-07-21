// Pure, dependency-free helpers for the altitude layer (quality affordances).
// No React — unit-testable from the repo-root vitest runner, like journal-util.
import type { CadenceDay } from "../types";

export type QualityTone = "high" | "mid" | "low" | "none";

/**
 * Provenance tone bands for anchored-evidence percent.
 * ≥75 reads as healthy (moss), ≥45 as workmanlike (ink), below as a flag
 * (red). null (no evidence at all) stays toneless — unknown, not bad.
 */
export function toneOfPct(pct: number | null): QualityTone {
  if (pct === null) return "none";
  if (pct >= 75) return "high";
  if (pct >= 45) return "mid";
  return "low";
}

/**
 * Scale day counts to bar heights (px) on a square-root scale, so one loud
 * day doesn't flatten the rest of the fortnight into invisibility.
 * Zero-event days get 0 (the strip renders them as a baseline tick).
 */
export function sparkHeights(cadence: CadenceDay[], maxPx: number, minPx = 3): number[] {
  const peak = Math.max(0, ...cadence.map((d) => d.events));
  if (peak === 0) return cadence.map(() => 0);
  return cadence.map((d) =>
    d.events === 0 ? 0 : Math.max(minPx, Math.round(Math.sqrt(d.events / peak) * maxPx)),
  );
}

/** "today" / "1d ago" / "6d ago" / "Jun 20" (beyond a week). */
export function relDay(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(then)) / 86_400_000);
  if (days <= 0) return "today";
  if (days <= 7) return `${days}d ago`;
  return then.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Short label for a fortnight caption: "384 events · 8 active days". */
export function cadenceCaption(totalEvents: number, activeDays: number, streak: number): string {
  const parts = [
    `${totalEvents} event${totalEvents === 1 ? "" : "s"}`,
    `${activeDays} active day${activeDays === 1 ? "" : "s"}`,
  ];
  if (streak >= 2) parts.push(`streak ${streak}`);
  return parts.join(" · ");
}
