import { describe, it, expect } from "vitest";
import { isCacheStale, buildFeedCacheKey } from "../../src/web/feed-composer.js";

describe("isCacheStale", () => {
  it("returns true when currentEventCount > eventCountAtCompose (after min-age window)", () => {
    // Compose is 6 minutes old — past the 5-min min-age guard — so new events make it stale.
    const sixMinAgo = new Date(Date.now() - 6 * 60_000);
    expect(isCacheStale({ eventCountAtCompose: 100, composedAt: sixMinAgo }, 101)).toBe(true);
  });
  it("returns false within the 5-min min-age window even with new events", () => {
    expect(isCacheStale({ eventCountAtCompose: 100, composedAt: new Date() }, 101)).toBe(false);
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
