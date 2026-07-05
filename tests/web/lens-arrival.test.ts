import { describe, it, expect } from "vitest";
import { buildArrivalBrief } from "../../src/web/lens-chat-utils.js";

describe("buildArrivalBrief — extended", () => {
  it("has 'course' in the zero-pending message", () => {
    expect(buildArrivalBrief(null, 0)).toContain("course");
  });
  it("mentions the count correctly for 1", () => {
    expect(buildArrivalBrief(null, 1)).toContain("1 thing");
  });
  it("pluralizes for > 1", () => {
    expect(buildArrivalBrief(null, 5)).toContain("5 things");
  });
});
