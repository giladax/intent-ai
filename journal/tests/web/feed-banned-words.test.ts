import { describe, it, expect } from "vitest";
import { containsBannedWords } from "../../src/web/feed-composer.js";

describe("containsBannedWords — voice-rule output scan", () => {
  it("detects 'river' in output", () => {
    expect(containsBannedWords("The river of events keeps flowing")).toBe(true);
  });

  it("detects 'sitting' in output", () => {
    expect(containsBannedWords("Sitting 3 opened a new branch")).toBe(true);
  });

  it("detects 'correspondence' in output", () => {
    expect(containsBannedWords("The correspondence covers many topics")).toBe(true);
  });

  it("detects 'edition' in output", () => {
    expect(containsBannedWords("This edition brings big changes")).toBe(true);
  });

  it("detects 'unfolded' in output", () => {
    expect(containsBannedWords("The story unfolded over many sessions")).toBe(true);
  });

  it("returns false for clean copy", () => {
    expect(containsBannedWords("The team fixed 3 bugs and shipped the auth refactor.")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(containsBannedWords("RIVER of changes")).toBe(true);
    expect(containsBannedWords("River of changes")).toBe(true);
  });

  it("does not flag partial word matches (e.g. 'delivery')", () => {
    expect(containsBannedWords("Fast delivery to production")).toBe(false);
  });

  it("does not flag 'sitting' inside compound words", () => {
    // "babysitting" shouldn't trigger — it's not a whole word match on "sitting"
    // This test is aspirational; the regex uses \b so "babysitting" would NOT match.
    expect(containsBannedWords("babysitting the process")).toBe(false);
  });
});
