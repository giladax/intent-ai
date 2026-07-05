// Advisory — dedupTrending overlap math tests

import { describe, it, expect } from "vitest";
import { dedupTrending } from "../../src/web/feed-composer.js";
import type { TrendingItem, FeatureEvidence } from "../../src/web/feed-composer.js";

const NOW = new Date();

function item(featureId: string, heatScore = 5): TrendingItem {
  return {
    featureId,
    featureName: `Feature ${featureId}`,
    events: [{ timestamp: NOW.toISOString(), featureId }],
    heatScore,
    heatLabel: "still warm",
    eventCount: 1,
  };
}

function ev(sessionIds: string[]): FeatureEvidence {
  return { summaries: [], sessionIds, actorInitials: [] };
}

describe("dedupTrending", () => {
  it("first item is always kept", () => {
    const items = [item("f1"), item("f2"), item("f3")];
    const evidenceMap = new Map([["f1", ev(["s1", "s2"])]]);
    const result = dedupTrending(items, evidenceMap);
    expect(result[0].featureId).toBe("f1");
  });

  it("suppresses a candidate when >50% session overlap with already-kept items", () => {
    // f1 keeps sessions s1, s2, s3. f2 has s1, s2 (2/2 = 100% overlap → suppress).
    const items = [item("f1", 10), item("f2", 8), item("f3", 6)];
    const evidenceMap = new Map([
      ["f1", ev(["s1", "s2", "s3"])],
      ["f2", ev(["s1", "s2"])],          // 2/2 = 100% overlap → suppressed
      ["f3", ev(["s4", "s5"])],          // 0/2 = 0% overlap → kept
    ]);
    const result = dedupTrending(items, evidenceMap);
    expect(result.map((i) => i.featureId)).toEqual(["f1", "f3"]);
  });

  it("keeps a candidate when <50% session overlap", () => {
    // f1 owns s1, s2. f2 has s1 and s3 — 1/2 = 50% which is NOT >50% → kept.
    const items = [item("f1", 10), item("f2", 8)];
    const evidenceMap = new Map([
      ["f1", ev(["s1", "s2"])],
      ["f2", ev(["s1", "s3"])],          // 1/2 = 50% → kept (threshold is strictly >50%)
    ]);
    const result = dedupTrending(items, evidenceMap);
    expect(result.map((i) => i.featureId)).toContain("f2");
  });

  it("items with no evidence are always kept (can't assess overlap)", () => {
    const items = [item("f1", 10), item("no-ev", 8)];
    const evidenceMap = new Map([["f1", ev(["s1", "s2"])]]);
    // "no-ev" has no evidence entry — should be kept
    const result = dedupTrending(items, evidenceMap);
    expect(result.map((i) => i.featureId)).toContain("no-ev");
  });

  it("preserves hottest-first order from the input", () => {
    // Items arrive hottest-first; dedup must not reorder kept items.
    const items = [item("f1", 10), item("f2", 7), item("f3", 4)];
    const evidenceMap = new Map([
      ["f1", ev(["s1"])],
      ["f2", ev(["s2"])],
      ["f3", ev(["s3"])],
    ]);
    const result = dedupTrending(items, evidenceMap);
    const scores = result.map((i) => i.heatScore);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it("caps output at maxItems", () => {
    const items = Array.from({ length: 8 }, (_, i) => item(`f${i}`, 10 - i));
    const evidenceMap = new Map(items.map((it) => [it.featureId, ev([`s${it.featureId}`])]));
    const result = dedupTrending(items, evidenceMap, 3);
    expect(result).toHaveLength(3);
  });

  it("empty session ids (empty array) treated as no evidence — always kept", () => {
    // An item with ev([]) has sids.length === 0 → treated as no evidence.
    const items = [item("f1", 10), item("f2", 8)];
    const evidenceMap = new Map([
      ["f1", ev(["s1"])],
      ["f2", ev([])],   // explicit empty array → no evidence → kept
    ]);
    const result = dedupTrending(items, evidenceMap);
    expect(result.map((i) => i.featureId)).toContain("f2");
  });
});
