/* ── ink/vocab: the app side of the verdict vocabulary ───────────────────
 *
 * The CANONICAL verdict→{label, verb, ink, severity} map lives in the backend
 * (quire/vocab.py, served at GET /api/vocab) so agents and the app read the
 * same meaning — F2's "one place" ruling. This module does two things and no
 * more:
 *
 *   1. holds the ink-token → CSS-variable map (design owns the palette; the
 *      backend only names the ink, e.g. "red", never a hex);
 *   2. gives a typed, cached accessor over /api/vocab with a safe fallback so
 *      a verdict always renders (never a blank badge).
 *
 * If you are hunting for "what does OFF_INTENT say?" — it is answered by the
 * server, not here. Here you find only how an ink becomes a colour. */

export type Ink = "red" | "amber" | "blue" | "green" | "gray";

export interface VerdictVocab {
  label: string;
  verb: string;
  ink: Ink;
  severity: "critical" | "high" | "medium" | "info";
}

export interface VocabPayload {
  verdicts: Record<string, VerdictVocab>;
  unknown: VerdictVocab;
  severityRank: Record<string, number>;
}

/** ink token → the CSS variables that paint it (fg, background, dot). */
export const INK_VARS: Record<Ink, { fg: string; bg: string }> = {
  red: { fg: "var(--red)", bg: "var(--red-bg)" },
  amber: { fg: "var(--amber)", bg: "var(--amber-bg)" },
  blue: { fg: "var(--blue)", bg: "var(--blue-bg)" },
  green: { fg: "var(--green)", bg: "var(--green-bg)" },
  gray: { fg: "var(--muted)", bg: "var(--gray-bg)" },
};

/** The dot class the tree/rows use for a verdict ink. */
export const dotClass = (ink: Ink): string => `d-${ink}`;

const FALLBACK: VocabPayload = {
  verdicts: {},
  unknown: { label: "Needs your review", verb: "needs your review", ink: "gray", severity: "medium" },
  severityRank: { critical: 0, high: 1, medium: 2, info: 3 },
};

let cache: VocabPayload | null = null;

/** Fetch (and cache) the vocabulary. Fail-safe: the fallback keeps the UI
 *  legible even if the endpoint is unreachable. */
export async function loadVocab(): Promise<VocabPayload> {
  if (cache) return cache;
  try {
    const res = await fetch("/api/vocab");
    if (!res.ok) throw new Error(String(res.status));
    cache = (await res.json()) as VocabPayload;
  } catch {
    cache = FALLBACK;
  }
  return cache;
}

/** Translate a raw classification enum via a loaded vocab payload. Always
 *  returns a renderable row. */
export function verdictOf(vocab: VocabPayload | null, enumValue: string | null | undefined): VerdictVocab {
  if (!vocab) return FALLBACK.unknown;
  if (!enumValue) return vocab.unknown;
  return vocab.verdicts[enumValue] ?? vocab.unknown;
}

/** Map a raw repo `latest_verdict` (or null) to a tree-dot ink. Null/unknown
 *  → gray (nothing decided yet), matching the mock's dormant repos. */
export function inkForVerdict(vocab: VocabPayload | null, enumValue: string | null | undefined): Ink {
  return verdictOf(vocab, enumValue).ink;
}
