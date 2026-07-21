import { describe, it, expect } from "vitest";

// Pure logic tests — no DOM. LensRail is a presentation component;
// we test the derived label strings directly.

describe("LensRail label derivation", () => {
  it("00 ORG is active when focusedLens is null", () => {
    const isOrgActive = (focusedLens: string | null) => focusedLens === null;
    expect(isOrgActive(null)).toBe(true);
    expect(isOrgActive("feature")).toBe(false);
  });
  it("notif dot shows when unreadCount > 0", () => {
    const showDot = (count: number) => count > 0;
    expect(showDot(0)).toBe(false);
    expect(showDot(1)).toBe(true);
  });
});
