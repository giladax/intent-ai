// tests/eval/fidelity.test.ts
import { describe, it, expect } from "vitest";
import {
  scoreProvenance, scoreCalibration, scoreTail,
  scoreRecall, scorePrecision, scoreAgency,
  type MomentFidelityRow,
} from "../../src/eval/fidelity.js";

const row = (over: Partial<MomentFidelityRow>): MomentFidelityRow => ({
  statement: "developer chose postgres",
  type: "commitment",
  agency: "developer",
  confidence: "high",
  chunkIndex: 0,
  occurredAt: null,
  evidenceQuotes: ["let's use postgres over sqlite"],
  anchoredEvidenceCount: 0,
  ...over,
});

describe("scoreProvenance", () => {
  it("counts fabricated default evidence as not real", () => {
    const s = scoreProvenance([
      row({ evidenceQuotes: ["no evidence provided"] }),
      row({ evidenceQuotes: ["a real verbatim quote from the session"] }),
    ]);
    expect(s.evidenceRealPct).toBe(50);
  });
  it("flags degenerate chunk spread (all moments on one chunk)", () => {
    const s = scoreProvenance([0, 0, 0, 0].map((c) => row({ chunkIndex: c })));
    expect(s.distinctChunks).toBe(1);
    expect(s.chunkSpreadOk).toBe(false);
  });
  it("accepts spread chunks and computes occurred-time span", () => {
    const s = scoreProvenance([
      row({ chunkIndex: 0, occurredAt: new Date("2026-07-03T10:00:00Z") }),
      row({ chunkIndex: 3, occurredAt: new Date("2026-07-03T12:00:00Z") }),
      row({ chunkIndex: 5, occurredAt: new Date("2026-07-03T11:00:00Z") }),
      row({ chunkIndex: 1, occurredAt: null }),
    ]);
    expect(s.chunkSpreadOk).toBe(true);
    expect(s.occurredTimeSpanMs).toBe(2 * 3600 * 1000);
  });
});

describe("scoreCalibration", () => {
  it("uniform values are uninformative", () => {
    const s = scoreCalibration(["high", "high", "high"]);
    expect(s.informative).toBe(false);
    expect(s.dominantShare).toBe(1);
  });
  it("nulls are counted under 'null'", () => {
    const s = scoreCalibration(["high", null, "medium"]);
    expect(s.distribution["null"]).toBe(1);
    expect(s.informative).toBe(true);
  });
});

describe("scoreTail", () => {
  it("flags a lost tail beyond 60s", () => {
    const s = scoreTail(new Date("2026-07-03T15:33:30Z"), new Date("2026-07-03T23:14:19Z"));
    expect(s.covered).toBe(false);
    expect(s.lostMs).toBeGreaterThan(7 * 3600 * 1000);
  });
  it("covers when digest end >= raw end", () => {
    expect(scoreTail(new Date("2026-07-03T12:00:00Z"), new Date("2026-07-03T12:00:30Z")).covered).toBe(true);
  });
});

describe("recall/precision/agency", () => {
  const moments = ["Developer committed to journal-as-product; trees rejected"];
  const narrative = "The session pivoted: the river is primary.";
  it("recall matches when all keywords present in a statement", () => {
    const r = scoreRecall(
      [
        { desc: "journal pivot", keywords: ["journal", "trees"] },
        { desc: "cron built", keywords: ["cron", "running"] },
      ],
      moments, narrative,
    );
    expect(r.matched).toBe(1);
    expect(r.missed).toEqual(["cron built"]);
  });
  it("precision flags forbidden claims", () => {
    const p = scorePrecision(
      [{ desc: "fabricated wrong-location", keywords: ["wrong location"] }],
      ["first edit targeted the wrong location in the file"], "",
    );
    expect(p.violations).toEqual(["fabricated wrong-location"]);
  });
  it("agency checks matched moments only", () => {
    const a = scoreAgency(
      [{ desc: "journal pivot", keywords: ["journal"], agency: "developer" }],
      [row({ statement: "Developer committed to journal-as-product", agency: "ai" })],
    );
    expect(a.checked).toBe(1);
    expect(a.correct).toBe(0);
    expect(a.wrong[0]).toContain("journal pivot");
  });
});
