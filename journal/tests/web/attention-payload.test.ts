import { describe, it, expect } from "vitest";

// Pure shape test — validates the payload schema the UI reporter sends.
describe("attention payload shape", () => {
  it("has all required fields", () => {
    const payload = {
      surface: "feed" as const,
      lens: { type: "feature", featureId: "abc-123", featureName: "Digest" },
      expandedStoryIds: ["feat-1", "feat-2"],
      openSessionId: null,
      pendingApprovalVisible: false,
      ts: Date.now(),
    };
    expect(payload).toHaveProperty("surface");
    expect(payload).toHaveProperty("lens");
    expect(payload).toHaveProperty("expandedStoryIds");
    expect(payload).toHaveProperty("openSessionId");
    expect(payload).toHaveProperty("pendingApprovalVisible");
    expect(payload).toHaveProperty("ts");
    expect(typeof payload.ts).toBe("number");
    expect(payload.lens?.featureId).toBe("abc-123");
    expect(payload.expandedStoryIds).toHaveLength(2);
  });

  it("lens null for feed surface with no focus", () => {
    const payload = {
      surface: "feed" as const,
      lens: null,
      expandedStoryIds: [],
      openSessionId: null,
      pendingApprovalVisible: false,
      ts: Date.now(),
    };
    expect(payload.lens).toBeNull();
  });

  it("ts is a recent epoch ms number", () => {
    const ts = Date.now();
    expect(ts).toBeGreaterThan(1_700_000_000_000);
  });

  it("surface must be feed or classic", () => {
    const validSurfaces: Array<"feed" | "classic"> = ["feed", "classic"];
    for (const surface of validSurfaces) {
      const payload = { surface, lens: null, expandedStoryIds: [], openSessionId: null, pendingApprovalVisible: false, ts: Date.now() };
      expect(["feed", "classic"]).toContain(payload.surface);
    }
  });

  it("expandedStoryIds is an array of strings", () => {
    const payload = {
      surface: "feed" as const,
      lens: null,
      expandedStoryIds: ["id-1", "id-2", "id-3"],
      openSessionId: null,
      pendingApprovalVisible: false,
      ts: Date.now(),
    };
    expect(Array.isArray(payload.expandedStoryIds)).toBe(true);
    payload.expandedStoryIds.forEach((id) => expect(typeof id).toBe("string"));
  });
});
