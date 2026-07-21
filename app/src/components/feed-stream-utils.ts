// feed-stream-utils — pure helpers for the FeedStream component.
// No React, no DOM. Tested in tests/web/feed-stream.test.ts.

/**
 * Format an ISO date relative to now: "today" / "yesterday" / locale date.
 */
export function formatRelativeDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (dayDiff === 0) return "today";
  if (dayDiff === 1) return "yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toLowerCase();
}

/**
 * Build the feed masthead label: "Quire · No. N · Sunday, July 5".
 * The product is Quire in every user-facing string.
 */
export function buildEditionLabel(n: number, date: Date): string {
  const formatted = date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  return `Quire · No. ${n} · ${formatted}`;
}

/**
 * Deterministic avatar color from initials — first letter keys the palette.
 * G → cobalt, D → vermilion, R → moss, C → marigold, anything else → amber.
 */
export function avatarColor(initials: string): { background: string; color?: string } {
  const first = (initials[0] ?? "").toUpperCase();
  switch (first) {
    case "G": return { background: "var(--lc-cobalt)" };
    case "D": return { background: "var(--lc-vermilion)" };
    case "R": return { background: "var(--lc-moss)" };
    case "C": return { background: "var(--lc-marigold)", color: "var(--lc-ink)" };
    default: return { background: "var(--lc-amber)" };
  }
}

/** An agent mark: initials of 3+ letters or containing "AI". */
export function isAgentInitials(initials: string): boolean {
  return initials.length >= 3 || initials.toUpperCase().includes("AI");
}

/** Story accent rotation — vermilion, marigold, cobalt by index. */
export function storyAccent(index: number): "vermilion" | "marigold" | "cobalt" {
  const accents = ["vermilion", "marigold", "cobalt"] as const;
  return accents[index % 3];
}

/**
 * Split a lede paragraph into a headline (first sentence) + the rest.
 * Long first sentences break at the em-dash — headlines stay short.
 * Backward-compat path: used only when the composed payload predates the
 * explicit `lede.headline` field (F1).
 */
export function splitLede(text: string): { headline: string; rest: string } {
  const m = text.match(/^(.+?[.!?])\s+(.*)$/s);
  let headline = m && m[1].length >= 12 ? m[1] : text;
  let rest = m && m[1].length >= 12 ? m[2] : "";
  if (headline.length > 110) {
    const dash = headline.indexOf(" — ");
    if (dash > 20) {
      rest = headline.slice(dash + 3).replace(/^./, (c) => c.toUpperCase()) + (rest ? " " + rest : "");
      headline = headline.slice(0, dash) + ".";
    }
  }
  return { headline, rest };
}

/**
 * Derive 7 deterministic heat-tick heights (px, 2–11) from a heat score.
 * Pseudo-varied so the ticks read as ambient life, not a chart.
 */
export function heatTicks(score: number): number[] {
  const base = Math.max(2, Math.min(11, Math.round(score)));
  const jitter = [0, 2, 4, 2, 0, 3, 1];
  return jitter.map((j) => Math.max(2, Math.min(11, base - 3 + j)));
}
