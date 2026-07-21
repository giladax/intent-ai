// Pure utilities for lens-chat scope context and arrival brief assembly.
// No imports from DB/server — these are UI-side helpers testable in vitest.

export interface LensScopeContext {
  featureId: string | null;
  timeRange: { since: string; until: string; label: string } | null;
}

export function buildLensScopeContext(
  lensType: "feature" | "timeline" | null,
  lensValue: string | null,
): LensScopeContext {
  if (!lensType || !lensValue) return { featureId: null, timeRange: null };

  if (lensType === "feature") {
    return { featureId: lensValue, timeRange: null };
  }

  if (lensType === "timeline") {
    const now = new Date();
    if (lensValue === "today") {
      const since = new Date(now);
      since.setHours(0, 0, 0, 0);
      return {
        featureId: null,
        timeRange: { since: since.toISOString(), until: now.toISOString(), label: "today" },
      };
    }
    if (lensValue === "week") {
      const since = new Date(now);
      since.setDate(since.getDate() - 7);
      return {
        featureId: null,
        timeRange: { since: since.toISOString(), until: now.toISOString(), label: "this week" },
      };
    }
    // Custom sitting ID — fall back to 7 days
    const since = new Date(now);
    since.setDate(since.getDate() - 7);
    return {
      featureId: null,
      timeRange: { since: since.toISOString(), until: now.toISOString(), label: lensValue },
    };
  }

  return { featureId: null, timeRange: null };
}

const LABEL_ALLOWLIST = new Set(["today", "this week"]);
const MAX_LABEL_LEN = 32;

/**
 * Server-side guard: allowlist known labels, else strip to safe chars + clamp.
 * Never throws; always returns a string safe for LLM system prompt inclusion.
 */
export function sanitizeLensLabel(raw: string | null | undefined): string {
  if (!raw) return "selected period";
  const lower = raw.toLowerCase().trim();
  if (LABEL_ALLOWLIST.has(lower)) return lower;
  // Strip to alphanumeric + space + hyphen, clamp to 32 chars.
  return raw.replace(/[^a-z0-9 \-]/gi, "").slice(0, MAX_LABEL_LEN).trim() || "selected period";
}

/** Derive the one-line arrival verdict from pending count + optional cadence hint. */
export function buildArrivalBrief(
  _stats: null | { streak: number; totalEvents: number },
  pendingCount: number,
): string {
  if (pendingCount > 0) {
    return `On course — ${pendingCount} thing${pendingCount === 1 ? "" : "s"} waiting for your stamp.`;
  }
  return "Quiet, and on course.";
}
