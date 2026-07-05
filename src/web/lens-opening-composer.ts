// lens-opening-composer.ts — assembles the seeded opening turn for any lens.
// The opening carries: top-level understanding, recent insights, pending count.
// Mostly deterministic; Sonnet polish is optional (only if sessionCount >= 3).

export interface LensOpeningInput {
  featureName: string;
  understanding: string | null;     // from feature's narrative / brain cards
  recentInsights: string[];         // up to 3, from approved observations
  pendingCount: number;
}

export interface LensOpeningResult {
  turn: string;                     // the seeded first-turn text
  polished: boolean;                // true if Sonnet was invoked
  citedSessionIds: string[];
}

/**
 * Truncate to the nearest sentence boundary at or below maxChars.
 * If no boundary found, hard-truncate and append "…".
 */
export function truncateToEssence(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const sub = text.slice(0, maxChars);
  const lastEnd = Math.max(sub.lastIndexOf(". "), sub.lastIndexOf("! "), sub.lastIndexOf("? "));
  if (lastEnd > maxChars * 0.4) {
    return text.slice(0, lastEnd + 1).trim() + "…";
  }
  return sub.trim() + "…";
}

/**
 * Build the deterministic opening turn text from the lens input.
 * Returns a plain-voice string ready to render as the brain's first turn.
 */
export function buildLensOpeningTurn(input: LensOpeningInput): string {
  const { featureName, understanding, recentInsights, pendingCount } = input;
  const parts: string[] = [];

  if (understanding && understanding.trim()) {
    parts.push(truncateToEssence(understanding.trim(), 600));
  } else {
    parts.push(`${featureName} is tracked here. No deep understanding built yet — start a session to add to it.`);
  }

  if (recentInsights.length > 0) {
    parts.push("Recent: " + recentInsights.slice(0, 3).join(" · "));
  }

  if (pendingCount > 0) {
    parts.push(`${pendingCount} thing${pendingCount === 1 ? "" : "s"} waiting for your approval — you can stamp them below.`);
  }

  return parts.join("\n\n");
}
