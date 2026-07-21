import { describe, it, expect } from "vitest";
import { computeHeatScore, rankTrending, heatLabel } from "../../src/web/feed-composer.js";
import { heatTicks } from "../../src/web/ui/src/components/feed-stream-utils.js";

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

describe("heatLabel", () => {
  it("returns 'hot' for score >= 8", () => {
    expect(heatLabel(8)).toBe("hot");
    expect(heatLabel(9)).toBe("hot");
    expect(heatLabel(100)).toBe("hot");
  });

  it("returns 'still warm' for score >= 2 and < 8", () => {
    expect(heatLabel(2)).toBe("still warm");
    expect(heatLabel(5)).toBe("still warm");
    expect(heatLabel(7.9)).toBe("still warm");
  });

  it("returns 'cooling' for score < 2", () => {
    expect(heatLabel(0)).toBe("cooling");
    expect(heatLabel(1)).toBe("cooling");
    expect(heatLabel(1.9)).toBe("cooling");
  });
});

describe("heatTicks", () => {
  it("returns an array of exactly 7 values", () => {
    expect(heatTicks(5)).toHaveLength(7);
    expect(heatTicks(0)).toHaveLength(7);
    expect(heatTicks(20)).toHaveLength(7);
  });

  it("all values are between 2 and 11 inclusive", () => {
    for (const score of [0, 1, 5, 8, 11, 20]) {
      const ticks = heatTicks(score);
      for (const t of ticks) {
        expect(t).toBeGreaterThanOrEqual(2);
        expect(t).toBeLessThanOrEqual(11);
      }
    }
  });
});
