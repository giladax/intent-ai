import { describe, it, expect } from "vitest";
import { isCacheStale, buildFeedCacheKey } from "../../src/web/feed-composer.js";

describe("isCacheStale", () => {
  it("returns true when currentEventCount > eventCountAtCompose", () => {
    expect(isCacheStale({ eventCountAtCompose: 100, composedAt: new Date() }, 101)).toBe(true);
  });
  it("returns false when counts match and compose is recent", () => {
    expect(isCacheStale({ eventCountAtCompose: 100, composedAt: new Date() }, 100)).toBe(false);
  });
  it("returns true when composedAt is older than 1 hour regardless of count", () => {
    const old = new Date(Date.now() - 3_700_000);
    expect(isCacheStale({ eventCountAtCompose: 100, composedAt: old }, 100)).toBe(true);
  });
});

describe("buildFeedCacheKey", () => {
  it("returns 'org' for org-level feed", () => {
    expect(buildFeedCacheKey()).toBe("org");
  });
});
