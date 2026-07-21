import { describe, it, expect } from "vitest";
import { buildNotifText, dedupNotifications } from "../../src/web/notifications.js";

describe("buildNotifText", () => {
  it("pending gate — single", () => {
    const text = buildNotifText({ type: "pending_gate", featureName: "Digest Pipeline", count: 1 });
    expect(text).not.toContain("undefined");
    expect(text).toContain("Digest Pipeline");
    expect(text.length).toBeLessThan(120);
  });
  it("activity since — specific actor", () => {
    const text = buildNotifText({ type: "area_activity", featureName: "Dashboard", actorName: "Dana", count: 3 });
    expect(text).toContain("Dana");
    expect(text).toContain("Dashboard");
  });
  it("contradicted decision", () => {
    const text = buildNotifText({ type: "contradicted", featureName: "Feed Composer", momentSummary: "the cache is always fresh" });
    expect(text).toContain("Feed Composer");
  });
});

describe("dedupNotifications", () => {
  it("removes duplicate type+featureId pairs", () => {
    const notifs = [
      { type: "pending_gate" as const, featureId: "f1", text: "a" },
      { type: "pending_gate" as const, featureId: "f1", text: "b" },
      { type: "area_activity" as const, featureId: "f1", text: "c" },
    ];
    expect(dedupNotifications(notifs)).toHaveLength(2);
  });
});
