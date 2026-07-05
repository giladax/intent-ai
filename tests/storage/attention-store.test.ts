import { describe, it, expect } from "vitest";
import { STALE_MS, isStaleDate } from "../../src/storage/attention-store.js";

describe("attention-store staleness", () => {
  it("STALE_MS is 10 minutes", () => {
    expect(STALE_MS).toBe(10 * 60 * 1000);
  });

  it("date 11 min ago is stale", () => {
    const d = new Date(Date.now() - 11 * 60 * 1000);
    expect(isStaleDate(d)).toBe(true);
  });

  it("date 9 min ago is not stale", () => {
    const d = new Date(Date.now() - 9 * 60 * 1000);
    expect(isStaleDate(d)).toBe(false);
  });

  it("exact boundary (10 min) is stale", () => {
    const d = new Date(Date.now() - 10 * 60 * 1000);
    expect(isStaleDate(d)).toBe(true);
  });

  it("date just now is not stale", () => {
    const d = new Date();
    expect(isStaleDate(d)).toBe(false);
  });
});
