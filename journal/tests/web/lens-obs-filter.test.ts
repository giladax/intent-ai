// I6 — feature-scoped approval card filter
// Tests filterPendingObsForLens (pure function, no React).

import { describe, it, expect } from "vitest";
import { filterPendingObsForLens } from "../../src/web/lens-obs-filter.js";
import type { PendingObservation } from "../../src/web/ui/src/types.js";

function obs(id: string, featureId: string | null): PendingObservation {
  return {
    id,
    category: "observation:constraint",
    summary: `obs ${id}`,
    feature_id: featureId,
    feature_name: featureId ? `Feature ${featureId}` : null,
    review_status: "pending",
    created_at: new Date().toISOString(),
  };
}

const OBS_F1 = obs("o1", "feat-1");
const OBS_F2 = obs("o2", "feat-2");
const OBS_NULL = obs("o3", null);
const OBS_F1B = obs("o4", "feat-1");

describe("filterPendingObsForLens", () => {
  it("org lens — returns all observations (up to 5)", () => {
    const all = [OBS_F1, OBS_F2, OBS_NULL, OBS_F1B];
    const result = filterPendingObsForLens(all, "org", null);
    expect(result).toHaveLength(4);
  });

  it("org lens — caps at 5", () => {
    const many = Array.from({ length: 8 }, (_, i) => obs(`o${i}`, "feat-1"));
    const result = filterPendingObsForLens(many, "org", null);
    expect(result).toHaveLength(5);
  });

  it("feature lens with selectedFeatureId — returns only that feature's observations", () => {
    const all = [OBS_F1, OBS_F2, OBS_NULL, OBS_F1B];
    const result = filterPendingObsForLens(all, "feature", "feat-1");
    expect(result.map((o) => o.id)).toEqual(["o1", "o4"]);
  });

  it("feature lens — hides unattributable observations (null feature_id)", () => {
    const all = [OBS_F1, OBS_NULL];
    const result = filterPendingObsForLens(all, "feature", "feat-1");
    expect(result.every((o) => o.id !== "o3")).toBe(true);
  });

  it("feature lens — returns empty array when no obs match the feature", () => {
    const all = [OBS_F2, OBS_NULL];
    const result = filterPendingObsForLens(all, "feature", "feat-1");
    expect(result).toHaveLength(0);
  });

  it("feature lens — caps at 5", () => {
    const many = Array.from({ length: 8 }, (_, i) => obs(`o${i}`, "feat-1"));
    const result = filterPendingObsForLens(many, "feature", "feat-1");
    expect(result).toHaveLength(5);
  });

  it("null lens (no selection) — behaves as org lens", () => {
    const all = [OBS_F1, OBS_F2, OBS_NULL];
    const result = filterPendingObsForLens(all, null, null);
    expect(result).toHaveLength(3);
  });

  it("feature lens with no selectedFeatureId — behaves as org lens", () => {
    const all = [OBS_F1, OBS_NULL];
    const result = filterPendingObsForLens(all, "feature", null);
    expect(result).toHaveLength(2);
  });
});
