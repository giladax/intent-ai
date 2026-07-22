import { describe, it, expect } from "vitest";
import { age } from "./age";

describe("age — the terse mono chip", () => {
  const now = Date.parse("2026-07-22T12:00:00Z");
  it("renders hours and days like the mock", () => {
    expect(age("2026-07-22T10:00:00Z", now)).toBe("2h");
    expect(age("2026-07-21T12:00:00Z", now)).toBe("1d");
    expect(age("2026-07-22T11:59:30Z", now)).toBe("30s");
  });
  it("is empty for missing or bad timestamps", () => {
    expect(age(null, now)).toBe("");
    expect(age("not-a-date", now)).toBe("");
  });
});
