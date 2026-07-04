import { describe, it, expect } from "vitest";
import { resolveEvidenceSourceIds } from "../../src/storage/queries.js";

describe("resolveEvidenceSourceIds", () => {
  const map = new Map([[7, "uuid-7"], [9, "uuid-9"]]);
  it("maps anchored evidence to the event uuid", () => {
    expect(resolveEvidenceSourceIds(
      [{ quote: "q", eventIndex: 7, anchored: true, sourceType: "user" }], map,
    )).toEqual(["uuid-7"]);
  });
  it("unanchored or unmapped evidence stays null", () => {
    expect(resolveEvidenceSourceIds(
      [
        { quote: "q", eventIndex: 7, anchored: false, sourceType: "ai" },
        { quote: "q", eventIndex: 99, anchored: true, sourceType: "ai" },
        { quote: "q", eventIndex: null, anchored: false, sourceType: "ai" },
      ], map,
    )).toEqual([null, null, null]);
  });
});
