/**
 * Content-quality regression tests for feed-composer.ts (three bugs):
 *
 * 1. Lede↔story repetition — the lede fallback must NOT share copy with story[0].
 * 2. Phrase-boundary headline truncation — word-cap must end at a clean boundary.
 *    Tests use buildFallbackStoryHeadline (12-word cap) since the lede is now
 *    org-level only (count-based, no truncation needed).
 * 3. Pluralization — "1 features" → "1 feature", "1 events" → "1 event".
 */
import { describe, it, expect } from "vitest";
import {
  buildFallbackLedeHeadline,
  buildFallbackStoryHeadline,
  buildFallbackLedeFallbackText,
} from "../../src/web/feed-composer.js";

// ── 1. Lede↔story dedup ────────────────────────────────────────────────────
//
// When both the lede and story[0] are built deterministically from the SAME
// top feature's summaries, the rendered page shows the same sentence three
// times (h1, story h2, story dek). The lede fallback must draw from a
// DIFFERENT signal — org-level synthesis (counts + cross-feature summary).

describe("lede↔story dedup", () => {
  const topFeatureSummaries = [
    "[outcome] Task 5 dispatched: implement the digest agent.",
    "[struggle] ESM import error blocked the build.",
  ];

  it("lede headline does not equal story[0] deepHeadline/h2 when built from the same top summaries", () => {
    // The story takes the top summary as its headline.
    const storyHeadline = buildFallbackStoryHeadline(topFeatureSummaries, "Digest Agent");

    // The lede should NOT derive its headline from the same top-feature summaries.
    // It receives a featureCount signal and may receive a cross-feature summary.
    const ledeHeadline = buildFallbackLedeHeadline(topFeatureSummaries, 3);

    // They must be different strings — identity is the bug.
    expect(ledeHeadline).not.toBe(storyHeadline);
  });

  it("lede text is NOT a prefix of the story dek when both fallback to the same evidence", () => {
    // The dek is built from summaries[0] stripped of prefix.
    const stripped = "Task 5 dispatched: implement the digest agent.";
    // The lede text fallback (org-level) must not start with the same stripped sentence.
    const ledeText = buildFallbackLedeFallbackText(3);
    expect(ledeText.startsWith(stripped)).toBe(false);
  });

  it("lede headline is org-level when featureCount > 1 and no summaries provided", () => {
    const h = buildFallbackLedeHeadline(undefined, 5);
    expect(h).toBe("5 active features.");
  });

  it("lede headline is singular '1 feature' not '1 features'", () => {
    const h = buildFallbackLedeHeadline(undefined, 1);
    expect(h).toBe("1 active feature.");
    expect(h).not.toContain("features");
  });
});

// ── 2. Phrase-boundary headline truncation ──────────────────────────────────
//
// Regression: "Task 5 dispatched: implement the digest agent — the first."
// With a ≤12-word cap (story headline), the old code cut after the word "the"
// — a dangling connective.
// Fix: truncate at the last full clause/phrase boundary (—, :, ,) within the
// word budget. If none, end at a word boundary WITHOUT trailing dangling words.
//
// Tests use buildFallbackStoryHeadline (12-word cap). The lede is now org-level
// only (count-based string) so it never needs phrase-boundary truncation.

describe("phrase-boundary headline truncation", () => {
  it("regression: summary ending in '— the first to run' does not produce a dangling 'the'", () => {
    // This summary is >12 words; the old code cut at word 12 which was "the".
    const summary = "[progress] Task 5 dispatched: implement the digest agent — the first to run end-to-end completely.";
    const h = buildFallbackStoryHeadline([summary], "Digest Agent");
    const words = h.replace(/[.!?]$/, "").split(/\s+/);
    // Must not end with a dangling connective.
    const danglers = new Set(["the", "a", "of", "and", "—", "or", "in", "to", "at", "on", "for", "with"]);
    const lastWord = words[words.length - 1].toLowerCase().replace(/[.,;:!?—]$/, "");
    expect(danglers.has(lastWord)).toBe(false);
    expect(words.length).toBeLessThanOrEqual(12);
  });

  it("truncates at the em-dash boundary when it falls within the word budget (12)", () => {
    // Words before —: "Task 5 dispatched: implement the digest" = 6 words → clean cut
    const summary = "[progress] Task 5 dispatched: implement the digest — agent runs end-to-end completely here now today.";
    const h = buildFallbackStoryHeadline([summary], "Digest Agent");
    // Should cut at the em-dash: "Task 5 dispatched: implement the digest."
    expect(h).toBe("Task 5 dispatched: implement the digest.");
  });

  it("truncates at colon boundary when it falls within the word budget", () => {
    // "Phase complete:" is at position 2 (word index 1) — well within 12-word budget.
    const summary = "[progress] Phase complete: implement and test the new parser module end to end here also there.";
    const h = buildFallbackStoryHeadline([summary], "Parser");
    // Should end at "complete" (colon stripped), no dangling connective.
    expect(h.endsWith(".")).toBe(true);
    const wordCount = h.replace(/\.$/, "").split(/\s+/).length;
    expect(wordCount).toBeLessThanOrEqual(12);
    expect(h.toLowerCase()).not.toMatch(/\b(the|a|of|and|or|in|to|at|on|for|with)\.$/);
  });

  it("does not exceed 12 words when there is no clause boundary", () => {
    const summary = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen";
    const h = buildFallbackStoryHeadline([summary], "Feature");
    const wordCount = h.replace(/[.!?]$/, "").split(/\s+/).length;
    expect(wordCount).toBeLessThanOrEqual(12);
  });

  it("does not end with a dangling connective when falling back to word boundary", () => {
    // No boundary markers — falls through to word-boundary path.
    // Word 12 is "the" — should be dropped.
    const summary = "one two three four five six seven eight nine ten eleven the last connective here";
    const h = buildFallbackStoryHeadline([summary], "Feature");
    const lastWord = h.replace(/[.!?]$/, "").split(/\s+/).pop()!.toLowerCase();
    const danglers = new Set(["the", "a", "of", "and", "—", "or", "in", "to", "at", "on", "for", "with"]);
    expect(danglers.has(lastWord)).toBe(false);
  });
});

// ── 3. Pluralization ──────────────────────────────────────────────────────
//
// "Quire has active work across 1 features." → "1 feature"
// "1 events in the last 48 hours." → "1 event"

describe("pluralization", () => {
  it("lede headline fallback: '1 active feature' (singular)", () => {
    const h = buildFallbackLedeHeadline(undefined, 1);
    expect(h).toBe("1 active feature.");
  });

  it("lede headline fallback: '2 active features' (plural)", () => {
    const h = buildFallbackLedeHeadline(undefined, 2);
    expect(h).toBe("2 active features.");
  });

  it("lede text fallback: '1 feature' (singular)", () => {
    const t = buildFallbackLedeFallbackText(1);
    expect(t).toContain("1 feature");
    expect(t).not.toContain("1 features");
  });

  it("lede text fallback: '3 features' (plural)", () => {
    const t = buildFallbackLedeFallbackText(3);
    expect(t).toContain("3 features");
  });
});
