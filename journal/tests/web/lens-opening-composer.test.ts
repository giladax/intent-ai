import { describe, it, expect } from "vitest";
import { buildLensOpeningTurn, truncateToEssence } from "../../src/web/lens-opening-composer.js";

describe("truncateToEssence", () => {
  it("returns text under maxChars unchanged", () => {
    expect(truncateToEssence("short", 100)).toBe("short");
  });
  it("truncates at sentence boundary and appends ellipsis", () => {
    const long = "First sentence. Second sentence. Third sentence. Fourth sentence.";
    const result = truncateToEssence(long, 40);
    expect(result.length).toBeLessThanOrEqual(40 + 3);
    expect(result.endsWith("…")).toBe(true);
  });
});

describe("buildLensOpeningTurn", () => {
  it("returns a non-empty string for a feature with no data", () => {
    const turn = buildLensOpeningTurn({ featureName: "Test", understanding: null, recentInsights: [], pendingCount: 0 });
    expect(turn.length).toBeGreaterThan(10);
    expect(turn).not.toContain("undefined");
    expect(turn).not.toContain("null");
  });
  it("includes pending count when > 0", () => {
    const turn = buildLensOpeningTurn({ featureName: "Test", understanding: null, recentInsights: [], pendingCount: 3 });
    expect(turn).toContain("3");
  });
});

describe("buildLensOpeningTurn — voice rule", () => {
  it("does not contain banned words", () => {
    const banned = ["river", "sitting", "ink", "correspondence", "edition", "sittings"];
    const turn = buildLensOpeningTurn({
      featureName: "Test",
      understanding: "Some understanding text with the word river and sitting in it.",
      recentInsights: [],
      pendingCount: 0,
    });
    // The turn is plain-voice assembly; the understanding may contain banned words
    // since it comes from raw DB data — the UI is responsible for NOT rendering
    // generated copy that violates voice rules. Only the PROMPT-generated opening
    // (from Sonnet polish) must be clean. So this test verifies that the function
    // itself doesn't add banned words.
    const addedContent = turn.replace("Some understanding text with the word river and sitting in it.", "");
    for (const word of banned) {
      expect(addedContent.toLowerCase()).not.toContain(word);
    }
  });
});
