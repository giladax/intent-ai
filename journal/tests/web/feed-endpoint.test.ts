import { describe, it, expect } from "vitest";
import { buildSkeletonFeed } from "../../src/web/feed-composer.js";

describe("buildSkeletonFeed", () => {
  it("returns a valid FeedComposed with empty trending", () => {
    const f = buildSkeletonFeed();
    expect(f.trending).toHaveLength(0);
    expect(typeof f.lede.text).toBe("string");
    expect(f.lede.text.length).toBeGreaterThan(0);
    expect(typeof f.editionNumber).toBe("number");
  });
  it("does not contain banned words in the lede", () => {
    const banned = ["river", "sitting", "ink", "correspondence", "edition", "sittings"];
    const f = buildSkeletonFeed();
    for (const word of banned) {
      expect(f.lede.text.toLowerCase()).not.toContain(word);
    }
  });
});
