import { describe, it, expect } from "vitest";
import { formatLastSeen, getLastSeenFromStorage, setLastSeenInStorage } from "../../src/web/ui/src/components/notif-utils.js";

describe("formatLastSeen", () => {
  it("formats hours ago correctly for < 24h", () => {
    const fourHoursAgo = new Date(Date.now() - 4 * 3_600_000).toISOString();
    expect(formatLastSeen(fourHoursAgo)).toContain("4 hours");
  });
  it("formats yesterday correctly", () => {
    const yesterday = new Date(Date.now() - 25 * 3_600_000).toISOString();
    expect(formatLastSeen(yesterday)).toContain("yesterday");
  });
});

describe("localStorage helpers", () => {
  it("roundtrips last-seen timestamp", () => {
    const ts = new Date().toISOString();
    setLastSeenInStorage(ts);
    expect(getLastSeenFromStorage()).toBe(ts);
  });
});
