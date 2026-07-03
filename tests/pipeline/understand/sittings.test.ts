import { describe, it, expect } from "vitest";
import { detectSittings, SITTING_GAP_MS } from "../../../src/pipeline/understand/sittings.js";
import type { NormalizedDevEvent } from "../../../src/adapters/types.js";

const ev = (causalOrder: number, iso: string): NormalizedDevEvent => ({
  id: `s-${causalOrder}`, sessionId: "s", timestamp: iso, causalOrder,
  category: "intent", actor: "user",
  content: { summary: "x", detail: "x" }, rawEventId: `r${causalOrder}`, turnId: `t${causalOrder}`,
} as NormalizedDevEvent);

describe("detectSittings", () => {
  it("one sitting when gaps stay under the threshold", () => {
    const out = detectSittings([ev(0, "2026-06-19T10:00:00Z"), ev(1, "2026-06-19T10:20:00Z")]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      sittingIndex: 0, startedAt: "2026-06-19T10:00:00Z", endedAt: "2026-06-19T10:20:00Z", eventRange: [0, 1],
    });
  });
  it("splits on a multi-day gap (the b9ab1a0c shape)", () => {
    const out = detectSittings([
      ev(0, "2026-06-19T11:00:00Z"), ev(1, "2026-06-19T11:24:00Z"),
      ev(2, "2026-06-21T20:08:00Z"), ev(3, "2026-06-21T20:30:00Z"),
      ev(4, "2026-06-22T16:00:00Z"),
    ]);
    expect(out.map((s) => s.eventRange)).toEqual([[0, 1], [2, 3], [4, 4]]);
    expect(out[1].sittingIndex).toBe(1);
  });
  it("a gap of exactly the threshold splits", () => {
    const t0 = Date.parse("2026-06-19T10:00:00Z");
    const out = detectSittings([ev(0, new Date(t0).toISOString()), ev(1, new Date(t0 + SITTING_GAP_MS).toISOString())]);
    expect(out).toHaveLength(2);
  });
  it("empty input → empty output", () => {
    expect(detectSittings([])).toEqual([]);
  });
});
