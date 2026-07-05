import { describe, it, expect } from "vitest";
import { computeHeatScore, rankTrending } from "../../src/web/feed-composer.js";

describe("computeHeatScore", () => {
  it("returns 0 for empty event list", () => {
    expect(computeHeatScore([], new Date())).toBe(0);
  });
  it("recent events score higher than old ones", () => {
    const now = new Date();
    const recent = Array.from({ length: 10 }, (_, i) => ({
      timestamp: new Date(now.getTime() - i * 60_000).toISOString(),
      featureId: "f1",
    }));
    const old = Array.from({ length: 10 }, (_, i) => ({
      timestamp: new Date(now.getTime() - (i + 720) * 60_000).toISOString(),
      featureId: "f2",
    }));
    const scoreRecent = computeHeatScore(recent, now);
    const scoreOld = computeHeatScore(old, now);
    expect(scoreRecent).toBeGreaterThan(scoreOld);
  });
  it("rankTrending returns items sorted descending by heat", () => {
    const now = new Date();
    const items = [
      { featureId: "f1", featureName: "Alpha", events: [{ timestamp: new Date(now.getTime() - 300_000).toISOString(), featureId: "f1" }] },
      { featureId: "f2", featureName: "Beta", events: Array.from({ length: 20 }, (_, i) => ({ timestamp: new Date(now.getTime() - i * 30_000).toISOString(), featureId: "f2" })) },
    ];
    const ranked = rankTrending(items, now);
    expect(ranked[0].featureId).toBe("f2");
  });
});
