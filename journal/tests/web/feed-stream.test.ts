import { describe, it, expect } from "vitest";
import { formatRelativeDate, buildEditionLabel, splitLede } from "../../../app/src/components/feed-stream-utils.js";

describe("formatRelativeDate", () => {
  it("returns 'today' for today's date", () => {
    const today = new Date().toISOString();
    expect(formatRelativeDate(today)).toBe("today");
  });
  it("returns 'yesterday' for yesterday", () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    expect(formatRelativeDate(yesterday)).toBe("yesterday");
  });
});

describe("buildEditionLabel", () => {
  it("returns a string with 'No.' and the edition number", () => {
    const label = buildEditionLabel(9, new Date());
    expect(label).toContain("No. 9");
  });
  it("says Quire, not Brain", () => {
    const label = buildEditionLabel(1, new Date());
    expect(label.toLowerCase()).not.toContain("brain");
  });
});

// F1 backward compat: cached payloads without an explicit `lede.headline`
// still derive a headline client-side via splitLede.
describe("splitLede (backward compat for pre-headline payloads)", () => {
  it("splits the first sentence off as the headline", () => {
    const { headline, rest } = splitLede("The audit landed. Everything else follows in the body.");
    expect(headline).toBe("The audit landed.");
    expect(rest).toBe("Everything else follows in the body.");
  });

  it("returns the whole text as headline when there is a single sentence", () => {
    const { headline, rest } = splitLede("A single sentence with no follow-up.");
    expect(headline).toBe("A single sentence with no follow-up.");
    expect(rest).toBe("");
  });

  it("breaks long first sentences at the em-dash", () => {
    const long =
      "The pipeline was rebuilt from scratch over three intense days of work — the new architecture separates extraction from weaving and verification. More detail here.";
    const { headline, rest } = splitLede(long);
    expect(headline.length).toBeLessThan(long.length);
    expect(headline.endsWith(".")).toBe(true);
    expect(rest.startsWith("The new architecture")).toBe(true);
  });

  it("does not split on a too-short first fragment", () => {
    const { headline } = splitLede("No. This starts with an abbreviation-like fragment.");
    expect(headline).toBe("No. This starts with an abbreviation-like fragment.");
  });
});
