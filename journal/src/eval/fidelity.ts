/**
 * Fidelity scoring core — pure functions, no I/O.
 *
 * Scoring for the digest-fidelity eval harness:
 *   - Provenance: evidence realness, chunk spread, time span
 *   - Calibration: confidence distribution shape
 *   - Tail: how much session tail the digest missed
 *   - Recall / Precision / Agency: criteria-based coverage checks
 */

const FABRICATED_DEFAULT = "no evidence provided";

/** A single row from the moments+evidence join used by the fidelity harness. */
export interface MomentFidelityRow {
  statement: string;
  type: string;
  agency: string | null;
  confidence: string | null;
  chunkIndex: number | null;
  occurredAt: Date | null;
  evidenceQuotes: string[];
  anchoredEvidenceCount: number; // evidence rows with non-null source_event_id
}

export interface ProvenanceScore {
  momentCount: number;
  evidenceRealPct: number;      // % of moments with ≥1 quote that is not the fabricated default
  evidenceAnchoredPct: number;  // % of moments with ≥1 anchored evidence row
  distinctChunks: number;
  chunkSpreadOk: boolean;       // distinctChunks > 1 when momentCount > 3
  occurredTimeSpanMs: number | null; // max-min occurredAt, null if none stamped
}

export interface CalibrationScore {
  distribution: Record<string, number>; // confidence value -> count (null keyed as "null")
  dominantShare: number;                // share of most common value, 0..1
  informative: boolean;                 // >1 distinct value AND dominantShare < 0.9
}

export interface TailScore {
  digestEndedAt: Date | null;
  rawLastEventAt: Date | null;
  lostMs: number;               // max(0, rawLastEventAt - digestEndedAt)
  covered: boolean;             // lostMs <= 60_000
}

export interface ExpectedMoment {
  desc: string;
  keywords: string[];
  agency?: "developer" | "ai" | "collaborative";
}

export interface ForbiddenClaim {
  desc: string;
  keywords: string[];
}

export interface RecallResult {
  expected: number;
  matched: number;
  missed: string[];
}

export interface PrecisionResult {
  violations: string[]; // descs of forbidden claims that matched
}

export interface AgencyResult {
  checked: number;
  correct: number;
  wrong: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Round a fraction to a percentage with 1 decimal place. */
function pct(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/** A quote is "real" when it is not the fabricated default and has ≥10 trimmed chars. */
function isRealQuote(q: string): boolean {
  return q !== FABRICATED_DEFAULT && q.trim().length >= 10;
}

/** Returns true when every keyword appears case-insensitively in text. */
function allKeywordsIn(keywords: string[], text: string): boolean {
  const lower = text.toLowerCase();
  return keywords.every((k) => lower.includes(k.toLowerCase()));
}

// ---------------------------------------------------------------------------
// scoreProvenance
// ---------------------------------------------------------------------------

export function scoreProvenance(moments: MomentFidelityRow[]): ProvenanceScore {
  const momentCount = moments.length;

  let realCount = 0;
  let anchoredCount = 0;
  const chunkSet = new Set<number>();
  const timestamps: number[] = [];

  for (const m of moments) {
    if (m.evidenceQuotes.some(isRealQuote)) realCount++;
    if (m.anchoredEvidenceCount > 0) anchoredCount++;
    if (m.chunkIndex !== null) chunkSet.add(m.chunkIndex);
    if (m.occurredAt !== null) timestamps.push(m.occurredAt.getTime());
  }

  const distinctChunks = chunkSet.size;
  const chunkSpreadOk = momentCount <= 3 || distinctChunks > 1;

  let occurredTimeSpanMs: number | null = null;
  if (timestamps.length >= 1) {
    occurredTimeSpanMs = Math.max(...timestamps) - Math.min(...timestamps);
  }

  return {
    momentCount,
    evidenceRealPct: pct(realCount, momentCount),
    evidenceAnchoredPct: pct(anchoredCount, momentCount),
    distinctChunks,
    chunkSpreadOk,
    occurredTimeSpanMs,
  };
}

// ---------------------------------------------------------------------------
// scoreCalibration
// ---------------------------------------------------------------------------

export function scoreCalibration(values: (string | null)[]): CalibrationScore {
  const distribution: Record<string, number> = {};
  for (const v of values) {
    const key = v === null ? "null" : v;
    distribution[key] = (distribution[key] ?? 0) + 1;
  }

  const counts = Object.values(distribution);
  const total = counts.reduce((a, b) => a + b, 0);
  const max = total === 0 ? 0 : Math.max(...counts);
  const dominantShare = total === 0 ? 0 : max / total;

  const distinctCount = Object.keys(distribution).length;
  const informative = distinctCount > 1 && dominantShare < 0.9;

  return { distribution, dominantShare, informative };
}

// ---------------------------------------------------------------------------
// scoreTail
// ---------------------------------------------------------------------------

export function scoreTail(
  digestEndedAt: Date | null,
  rawLastEventAt: Date | null,
): TailScore {
  let lostMs = 0;
  if (digestEndedAt !== null && rawLastEventAt !== null) {
    lostMs = Math.max(0, rawLastEventAt.getTime() - digestEndedAt.getTime());
  }
  return {
    digestEndedAt,
    rawLastEventAt,
    lostMs,
    covered: lostMs <= 60_000,
  };
}

// ---------------------------------------------------------------------------
// scoreRecall
// ---------------------------------------------------------------------------

export function scoreRecall(
  expected: ExpectedMoment[],
  momentStatements: string[],
  narrativeText: string,
): RecallResult {
  const missed: string[] = [];
  let matched = 0;

  for (const item of expected) {
    const foundInStatement = momentStatements.some((s) =>
      allKeywordsIn(item.keywords, s),
    );
    const foundInNarrative = allKeywordsIn(item.keywords, narrativeText);
    if (foundInStatement || foundInNarrative) {
      matched++;
    } else {
      missed.push(item.desc);
    }
  }

  return { expected: expected.length, matched, missed };
}

// ---------------------------------------------------------------------------
// scorePrecision
// ---------------------------------------------------------------------------

export function scorePrecision(
  forbidden: ForbiddenClaim[],
  momentStatements: string[],
  narrativeText: string,
): PrecisionResult {
  const violations: string[] = [];

  for (const claim of forbidden) {
    const foundInStatement = momentStatements.some((s) =>
      allKeywordsIn(claim.keywords, s),
    );
    const foundInNarrative = allKeywordsIn(claim.keywords, narrativeText);
    if (foundInStatement || foundInNarrative) {
      violations.push(claim.desc);
    }
  }

  return { violations };
}

// ---------------------------------------------------------------------------
// scoreAgency
// ---------------------------------------------------------------------------

export function scoreAgency(
  expected: ExpectedMoment[],
  moments: MomentFidelityRow[],
): AgencyResult {
  let checked = 0;
  let correct = 0;
  const wrong: string[] = [];

  for (const item of expected) {
    if (!item.agency) continue;

    // Find the first moment whose statement matches all keywords
    const match = moments.find((m) => allKeywordsIn(item.keywords, m.statement));
    if (!match) continue;

    checked++;
    if (match.agency === item.agency) {
      correct++;
    } else {
      wrong.push(`${item.desc}: got ${match.agency}, want ${item.agency}`);
    }
  }

  return { checked, correct, wrong };
}
