// WS-B — pure helpers for the observation approval loop and the feature↔file map.
// Kept dependency-free so they are unit-testable without Postgres.
//
// Contract (owned by WS-A, consumed here):
//   - Observations are `activity_events` rows with category `observation:<kind>`,
//     `feature_id` set (DENORMALIZED text, not a FK), `review_status` text
//     (freeform: pending | approved | rejected by convention — NO enum/CHECK).
//   - Approving an observation promotes its `summary` into
//     `features.current_understanding`; rejecting sets `review_status = 'rejected'`;
//     editing updates the observation `summary`.

export const OBSERVATION_CATEGORY_PREFIX = "observation:";

/** Freeform review states. Stored as plain TEXT — never as a DB enum/CHECK. */
export type ReviewStatus = "pending" | "approved" | "rejected";

/**
 * Promote an approved observation into a feature's Current Understanding.
 *
 * Current Understanding (Week-1) is assembled text: the feature description plus
 * approved observations, appended as bullet lines. This is intentionally simple
 * (concatenate, not "continuously construct"). It:
 *   - trims whitespace,
 *   - appends the observation as a `- ` bullet,
 *   - is idempotent: an observation whose text already appears (case-insensitive,
 *     whitespace-normalized) is not appended twice.
 */
export function composeCurrentUnderstanding(
  existing: string | null | undefined,
  observationText: string,
): string {
  const obs = (observationText ?? "").trim();
  const base = (existing ?? "").trim();
  if (!obs) return base;

  if (containsLine(base, obs)) return base;

  const bullet = obs.startsWith("- ") ? obs : `- ${obs}`;
  return base ? `${base}\n${bullet}` : bullet;
}

/** True if `text` already contains `candidate` as a line (normalized compare). */
export function containsLine(text: string, candidate: string): boolean {
  const target = normalize(candidate);
  if (!target) return false;
  return text
    .split("\n")
    .map((l) => normalize(l.replace(/^[-*]\s+/, "")))
    .some((l) => l === target);
}

function normalize(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Validate + normalize a glob for the feature↔file map.
 * Globs are stored verbatim; we only trim and reject empties. Returns null when
 * the input is unusable so the caller can 400.
 */
export function normalizeGlob(input: string | null | undefined): string | null {
  const g = (input ?? "").trim();
  if (!g) return null;
  return g;
}

/** True for a category that denotes an observation event. */
export function isObservationCategory(category: string | null | undefined): boolean {
  return typeof category === "string" && category.startsWith(OBSERVATION_CATEGORY_PREFIX);
}

/** The `<kind>` portion of an `observation:<kind>` category (or "" if none). */
export function observationKind(category: string | null | undefined): string {
  if (!isObservationCategory(category)) return "";
  return (category as string).slice(OBSERVATION_CATEGORY_PREFIX.length);
}
