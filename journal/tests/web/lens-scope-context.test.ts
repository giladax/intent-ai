import { describe, it, expect } from "vitest";
import { buildLensScopeContext } from "../../src/web/lens-chat-utils.js";

describe("buildLensScopeContext — edge cases", () => {
  it("handles unknown lensValue gracefully", () => {
    const ctx = buildLensScopeContext("timeline", "unknown-sitting");
    expect(ctx.timeRange).not.toBeNull();
    expect(ctx.timeRange!.label).toBe("unknown-sitting");
  });
  it("feature with empty string value returns null", () => {
    const ctx = buildLensScopeContext("feature", "");
    // empty string is falsy
    expect(ctx.featureId).toBeNull();
  });
});
