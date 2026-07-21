import { describe, it, expect } from "vitest";
import { formatAttentionMcpText } from "../../src/mcp/attention-formatter.js";
import type { AttentionState } from "../../src/storage/attention-store.js";

describe("formatAttentionMcpText", () => {
  it("reports no attention when state is null", () => {
    const result = formatAttentionMcpText(null, null);
    expect(result).toContain("No attention reported");
  });

  it("reports no attention when state has no surface", () => {
    const result = formatAttentionMcpText({} as AttentionState, null);
    expect(result).toContain("No attention reported");
  });

  it("includes feature name in output", () => {
    const state: AttentionState = {
      surface: "feed",
      lens: { type: "feature", featureId: "abc", featureName: "My Feature" },
      expandedStoryIds: [],
      openSessionId: null,
      pendingApprovalVisible: false,
      ts: Date.now(),
    };
    const result = formatAttentionMcpText(state, new Date());
    expect(result).toContain("My Feature");
  });

  it("marks stale output", () => {
    const state: AttentionState = {
      surface: "feed",
      lens: null,
      expandedStoryIds: [],
      openSessionId: null,
      pendingApprovalVisible: false,
      ts: Date.now() - 20 * 60 * 1000,
    };
    const result = formatAttentionMcpText(state, new Date(Date.now() - 20 * 60 * 1000), true);
    expect(result).toContain("stale");
  });

  it("includes open session id", () => {
    const state: AttentionState = {
      surface: "feed",
      lens: null,
      expandedStoryIds: [],
      openSessionId: "abc-session-id",
      pendingApprovalVisible: false,
      ts: Date.now(),
    };
    const result = formatAttentionMcpText(state, new Date());
    expect(result).toContain("abc-session-id");
  });

  it("includes expanded story ids", () => {
    const state: AttentionState = {
      surface: "feed",
      lens: null,
      expandedStoryIds: ["feat-a", "feat-b"],
      openSessionId: null,
      pendingApprovalVisible: false,
      ts: Date.now(),
    };
    const result = formatAttentionMcpText(state, new Date());
    expect(result).toContain("feat-a");
    expect(result).toContain("feat-b");
  });

  it("includes updatedAt timestamp", () => {
    const state: AttentionState = {
      surface: "classic",
      lens: null,
      expandedStoryIds: [],
      openSessionId: null,
      pendingApprovalVisible: false,
      ts: Date.now(),
    };
    const now = new Date("2026-07-06T12:00:00.000Z");
    const result = formatAttentionMcpText(state, now);
    expect(result).toContain("2026-07-06");
  });

  it("shows feed lens label when no lens active", () => {
    const state: AttentionState = {
      surface: "feed",
      lens: null,
      expandedStoryIds: [],
      openSessionId: null,
      pendingApprovalVisible: false,
      ts: Date.now(),
    };
    const result = formatAttentionMcpText(state, null);
    expect(result).toContain("feed");
  });
});
