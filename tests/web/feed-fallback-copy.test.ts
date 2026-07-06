import { describe, it, expect } from "vitest";
import {
  buildFallbackStoryHeadline,
  buildFallbackLedeHeadline,
  buildFallbackDeep,
} from "../../src/web/feed-composer.js";

// F6: story headlines carry news from the evidence, never the feature name
// (the feature name already lives in the kick line above the h2).
describe("buildFallbackStoryHeadline", () => {
  it("uses the first sentence of the top event summary, not the feature name", () => {
    const summaries = ["[outcome.verified] Digest quality was audited yesterday. More detail follows."];
    const h = buildFallbackStoryHeadline(summaries, "Activity Event Backbone");
    expect(h).toBe("Digest quality was audited yesterday.");
    expect(h).not.toContain("Activity Event Backbone");
  });

  it("strips the [category] prefix from the summary", () => {
    const h = buildFallbackStoryHeadline(["[struggle.blocked] The build broke on ESM imports."], "F");
    expect(h.startsWith("The build broke")).toBe(true);
    expect(h).not.toContain("[");
  });

  it("caps the headline at 12 words", () => {
    const long = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen and more";
    const h = buildFallbackStoryHeadline([long], "F");
    expect(h.replace(/\.$/, "").split(" ")).toHaveLength(12);
  });

  it("falls back to the feature name only when there is no evidence", () => {
    expect(buildFallbackStoryHeadline([], "My Feature")).toBe("My Feature");
    // regression: `undefined + "."` must never leak as the headline
    expect(buildFallbackStoryHeadline([], "My Feature")).not.toContain("undefined");
  });

  it("falls back to the feature name when the summary is empty", () => {
    expect(buildFallbackStoryHeadline([""], "My Feature")).toBe("My Feature");
  });
});

// F1: the org lede gets a real headline from the hottest feature's evidence.
describe("buildFallbackLedeHeadline", () => {
  it("uses the first sentence of the top summary, capped at 10 words", () => {
    const h = buildFallbackLedeHeadline(
      ["[outcome] The daemon was sinking events to a file and not the DB. Fixed."],
      3,
    );
    expect(h).toBe("The daemon was sinking events to a file and not.");
    expect(h.replace(/\.$/, "").split(" ").length).toBeLessThanOrEqual(10);
  });

  it("falls back to the feature count when there is no evidence", () => {
    expect(buildFallbackLedeHeadline(undefined, 4)).toBe("4 active features.");
    expect(buildFallbackLedeHeadline([], 2)).toBe("2 active features.");
  });
});

// F5: the deep cut is assembled from the REMAINING summaries — the press
// always reveals information the dek did not already show.
describe("buildFallbackDeep", () => {
  const summaries = [
    "[a] First event used by the dek.",
    "[b] Second event with a new angle. Extra detail.",
    "[c] Third event happened.",
    "[d] Fourth event closed the loop.",
  ];

  it("builds deep from summaries after the first (dek already used it)", () => {
    const { deep } = buildFallbackDeep(summaries);
    expect(deep).toBeDefined();
    expect(deep).not.toContain("First event used by the dek");
    expect(deep).toContain("Second event");
    expect(deep).toContain("Third event");
  });

  it("splits into two paragraphs when more than 2 remaining summaries", () => {
    const { deep } = buildFallbackDeep(summaries);
    expect(deep!.split("\n\n")).toHaveLength(2);
  });

  it("deepHeadline comes from the second summary, ≤12 words, never the first", () => {
    const { deepHeadline } = buildFallbackDeep(summaries);
    expect(deepHeadline).toBe("Second event with a new angle.");
  });

  it("returns empty object when there is nothing beyond the dek", () => {
    expect(buildFallbackDeep(["[a] Only one event."])).toEqual({});
    expect(buildFallbackDeep([])).toEqual({});
  });

  it("strips category prefixes from the deep body", () => {
    const { deep } = buildFallbackDeep(summaries);
    expect(deep).not.toMatch(/\[[abcd]\]/);
  });
});
