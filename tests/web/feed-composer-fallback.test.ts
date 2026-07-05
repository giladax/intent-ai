import { describe, it, expect } from "vitest";
import {
  buildSkeletonFeed,
  isCacheStale,
  containsBannedWords,
} from "../../src/web/feed-composer.js";

// The fallback path: buildSkeletonFeed() returns a valid FeedComposed shape
// even when the DB and LLM are unavailable.
describe("composer-fallback path", () => {
  it("buildSkeletonFeed returns a valid FeedComposed shape", () => {
    const feed = buildSkeletonFeed();
    expect(feed).toHaveProperty("editionNumber");
    expect(feed).toHaveProperty("composedAt");
    expect(feed.lede).toHaveProperty("text");
    expect(Array.isArray(feed.lede.citedSessionIds)).toBe(true);
    expect(Array.isArray(feed.trending)).toBe(true);
    expect(feed.editionNumber).toBe(0);
  });

  it("skeleton text does not contain banned words", () => {
    const feed = buildSkeletonFeed();
    expect(containsBannedWords(feed.lede.text)).toBe(false);
  });

  it("isCacheStale: degraded compose expires after 5min, not 1hr", () => {
    const fourMinAgo = new Date(Date.now() - 4 * 60_000);
    const sixMinAgo = new Date(Date.now() - 6 * 60_000);

    // Degraded: expires at 5 min
    expect(isCacheStale({ eventCountAtCompose: 5, composedAt: fourMinAgo }, 5, true)).toBe(false);
    expect(isCacheStale({ eventCountAtCompose: 5, composedAt: sixMinAgo }, 5, true)).toBe(true);

    // Normal: still fresh at 6 min
    expect(isCacheStale({ eventCountAtCompose: 5, composedAt: sixMinAgo }, 5, false)).toBe(false);
  });

  it("isCacheStale: never recomposes within the 5-min minimum age window", () => {
    const twoMinAgo = new Date(Date.now() - 2 * 60_000);
    // Even with new events, should not stale within 5 minutes
    expect(isCacheStale({ eventCountAtCompose: 5, composedAt: twoMinAgo }, 999)).toBe(false);
  });
});
