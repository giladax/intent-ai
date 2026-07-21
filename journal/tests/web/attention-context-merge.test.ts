import { describe, it, expect } from "vitest";
import { buildAttentionContext } from "../../src/web/attention-context.js";
import type { AttentionState } from "../../src/storage/attention-store.js";

describe("buildAttentionContext", () => {
  it("returns null for null state", () => {
    const result = buildAttentionContext(null);
    expect(result).toBeNull();
  });

  it("includes feature name when lens is feature", () => {
    const state: AttentionState = {
      surface: "feed",
      lens: { type: "feature", featureId: "abc-123", featureName: "Digest Pipeline" },
      expandedStoryIds: [],
      openSessionId: null,
      pendingApprovalVisible: false,
      ts: Date.now(),
    };
    const result = buildAttentionContext(state);
    expect(result).toContain("Digest Pipeline");
  });

  it("handles feed surface with no lens", () => {
    const state: AttentionState = {
      surface: "feed",
      lens: null,
      expandedStoryIds: [],
      openSessionId: null,
      pendingApprovalVisible: false,
      ts: Date.now(),
    };
    const result = buildAttentionContext(state);
    expect(result).toContain("feed");
  });

  it("mentions open session id", () => {
    const state: AttentionState = {
      surface: "feed",
      lens: null,
      expandedStoryIds: [],
      openSessionId: "abcdefgh-uuid-1234",
      pendingApprovalVisible: false,
      ts: Date.now(),
    };
    const result = buildAttentionContext(state);
    // slice(0, 8) of "abcdefgh-uuid-1234" is "abcdefgh"
    expect(result).toContain("abcdefgh");
  });

  it("mentions timeline lens type", () => {
    const state: AttentionState = {
      surface: "feed",
      lens: { type: "timeline" },
      expandedStoryIds: [],
      openSessionId: null,
      pendingApprovalVisible: false,
      ts: Date.now(),
    };
    const result = buildAttentionContext(state);
    expect(result).toContain("Timeline");
  });

  it("returns null for state without surface property", () => {
    const result = buildAttentionContext({} as AttentionState);
    expect(result).toBeNull();
  });
});
