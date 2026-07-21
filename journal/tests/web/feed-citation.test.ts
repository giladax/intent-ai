import { describe, it, expect } from "vitest";
import { filterCitations } from "../../src/web/feed-composer.js";

describe("filterCitations — fabricated-citation rejection", () => {
  it("drops ids not in the known DB set", () => {
    const db = ["sess-aaa", "sess-bbb"];
    const model = ["sess-aaa", "fabricated-xyz", "sess-bbb", "made-up-123"];
    expect(filterCitations(model, db)).toEqual(["sess-aaa", "sess-bbb"]);
  });

  it("returns [] when model returns ids but knownSessionIds is empty (lede case)", () => {
    expect(filterCitations(["any-id", "another"], [])).toEqual([]);
  });

  it("returns [] when model returns empty list", () => {
    expect(filterCitations([], ["sess-aaa"])).toEqual([]);
  });

  it("preserves order of model-returned ids that are in the known set", () => {
    const db = ["a", "b", "c"];
    const model = ["c", "a"];
    expect(filterCitations(model, db)).toEqual(["c", "a"]);
  });

  it("handles all fabricated — returns empty", () => {
    expect(filterCitations(["fake1", "fake2"], ["real1", "real2"])).toEqual([]);
  });
});
