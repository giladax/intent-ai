import { describe, it, expect } from "vitest";
import { formatRelativeDate, buildEditionLabel } from "../../src/web/ui/src/components/feed-stream-utils.js";

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
