import { describe, it, expect } from "vitest";
import { buildLensScopeContext, buildArrivalBrief } from "../../src/web/lens-chat-utils.js";

describe("buildLensScopeContext", () => {
  it("returns null scope when no lens selected", () => {
    expect(buildLensScopeContext(null, null)).toEqual({ featureId: null, timeRange: null });
  });
  it("returns featureId scope for feature lens", () => {
    expect(buildLensScopeContext("feature", "feat-123")).toEqual({ featureId: "feat-123", timeRange: null });
  });
  it("returns timeRange scope for timeline lens with 'today'", () => {
    const ctx = buildLensScopeContext("timeline", "today");
    expect(ctx.featureId).toBeNull();
    expect(ctx.timeRange).not.toBeNull();
    expect(ctx.timeRange!.label).toBe("today");
  });
  it("returns timeRange scope for timeline lens with 'week'", () => {
    const ctx = buildLensScopeContext("timeline", "week");
    expect(ctx.timeRange?.label).toBe("this week");
  });
});

describe("buildArrivalBrief", () => {
  it("returns empty string for null stats", () => {
    expect(buildArrivalBrief(null, 0)).toBe("Quiet, and on course.");
  });
  it("includes pending count in brief when > 0", () => {
    const brief = buildArrivalBrief(null, 3);
    expect(brief).toContain("3");
  });
});
