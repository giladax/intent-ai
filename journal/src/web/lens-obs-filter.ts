// lens-obs-filter.ts — pure filter for pending observations scoped to a lens.
// No React, no DB imports. Tested in tests/web/lens-obs-filter.test.ts.

import type { PendingObservation } from "./ui/src/types.js";

type LensType = "feature" | "timeline" | "org" | null;

const MAX_PENDING_FOR_CHAT = 5;

/**
 * Filter pending observations for display in the chat panel, scoped to the
 * current lens selection.
 *
 * Rules:
 *   - org lens (or no lens): return all observations, capped at MAX_PENDING_FOR_CHAT
 *   - feature lens with a selectedFeatureId: return only observations attributed
 *     to that feature (feature_id matches). Observations with null feature_id
 *     are NOT shown under a feature lens — they are unattributable.
 *   - feature lens without a selectedFeatureId: fall back to org-lens behaviour
 *
 * @param observations  Full pending observation list from the API
 * @param focusedLens   Current lens type (null | "org" | "feature" | "timeline")
 * @param selectedFeatureId  The currently selected feature's id (or null)
 */
export function filterPendingObsForLens(
  observations: PendingObservation[],
  focusedLens: LensType,
  selectedFeatureId: string | null,
): PendingObservation[] {
  if (focusedLens === "feature" && selectedFeatureId !== null) {
    // Feature lens: only show observations attributed to this feature.
    // Unattributable (null feature_id) observations are hidden.
    return observations
      .filter((o) => o.feature_id === selectedFeatureId)
      .slice(0, MAX_PENDING_FOR_CHAT);
  }

  // Org lens, timeline lens, or null: show all, capped.
  return observations.slice(0, MAX_PENDING_FOR_CHAT);
}
