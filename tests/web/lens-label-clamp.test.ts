import { describe, it, expect } from "vitest";
import { sanitizeLensLabel } from "../../src/web/lens-chat-utils.js";

describe("sanitizeLensLabel", () => {
  it("passes through 'today' as-is", () => {
    expect(sanitizeLensLabel("today")).toBe("today");
  });

  it("passes through 'this week' as-is", () => {
    expect(sanitizeLensLabel("this week")).toBe("this week");
  });

  it("strips non-alphanumeric characters", () => {
    const result = sanitizeLensLabel("injected</script>evil");
    expect(result).not.toContain("<");
    expect(result).not.toContain(">");
    expect(result).not.toContain("/");
  });

  it("clamps to 32 characters", () => {
    const long = "a".repeat(100);
    expect(sanitizeLensLabel(long).length).toBeLessThanOrEqual(32);
  });

  it("returns 'selected period' for null/undefined/empty", () => {
    expect(sanitizeLensLabel(null)).toBe("selected period");
    expect(sanitizeLensLabel(undefined)).toBe("selected period");
    expect(sanitizeLensLabel("")).toBe("selected period");
  });

  it("returns 'selected period' when only forbidden chars remain", () => {
    expect(sanitizeLensLabel("!@#$%^&*()")).toBe("selected period");
  });

  it("is case-insensitive for allowlist", () => {
    expect(sanitizeLensLabel("TODAY")).toBe("today");
    expect(sanitizeLensLabel("This Week")).toBe("this week");
  });
});
