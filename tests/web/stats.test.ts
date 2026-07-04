import { describe, it, expect } from "vitest";
import {
  fillCadence,
  cadenceSummary,
  anchoredPct,
  classifyMomentum,
  buildStatsOverview,
  emptyStatsOverview,
  localDayKey,
} from "../../src/web/stats.js";

// A fixed local "now": Sat 2026-07-04, mid-afternoon.
const NOW = new Date(2026, 6, 4, 15, 30, 0);

describe("localDayKey", () => {
  it("formats a local date as YYYY-MM-DD", () => {
    expect(localDayKey(NOW)).toBe("2026-07-04");
    expect(localDayKey(new Date(2026, 0, 9))).toBe("2026-01-09");
  });
});

describe("fillCadence", () => {
  it("returns exactly windowDays entries, oldest first, ending today", () => {
    const out = fillCadence([], 14, NOW);
    expect(out).toHaveLength(14);
    expect(out[0].day).toBe("2026-06-21");
    expect(out[13].day).toBe("2026-07-04");
  });

  it("fills missing days with zero and keeps provided counts", () => {
    const out = fillCadence(
      [
        { day: "2026-07-04", events: 22 },
        { day: "2026-07-03", events: 178 },
        { day: "2026-06-27", events: 42 },
      ],
      14,
      NOW,
    );
    const byDay = new Map(out.map((d) => [d.day, d.events]));
    expect(byDay.get("2026-07-04")).toBe(22);
    expect(byDay.get("2026-07-03")).toBe(178);
    expect(byDay.get("2026-06-27")).toBe(42);
    expect(byDay.get("2026-07-01")).toBe(0);
    expect(out.filter((d) => d.events > 0)).toHaveLength(3);
  });

  it("ignores rows older than the window", () => {
    const out = fillCadence([{ day: "2026-06-05", events: 44 }], 14, NOW);
    expect(out.every((d) => d.events === 0)).toBe(true);
  });
});

describe("cadenceSummary", () => {
  it("totals events and counts active days", () => {
    const s = cadenceSummary([
      { day: "d1", events: 0 },
      { day: "d2", events: 3 },
      { day: "d3", events: 5 },
    ]);
    expect(s.totalEvents).toBe(8);
    expect(s.activeDays).toBe(2);
  });

  it("streak counts consecutive active days ending at the newest", () => {
    const s = cadenceSummary([
      { day: "d1", events: 2 },
      { day: "d2", events: 0 },
      { day: "d3", events: 4 },
      { day: "d4", events: 1 },
    ]);
    expect(s.streak).toBe(2);
  });

  it("a quiet today does not zero yesterday's streak", () => {
    const s = cadenceSummary([
      { day: "d1", events: 4 },
      { day: "d2", events: 1 },
      { day: "d3", events: 0 }, // today, so far
    ]);
    expect(s.streak).toBe(2);
  });

  it("only the final quiet day is forgiven", () => {
    const s = cadenceSummary([
      { day: "d1", events: 4 },
      { day: "d2", events: 0 },
      { day: "d3", events: 0 },
    ]);
    expect(s.streak).toBe(0);
  });

  it("handles an empty cadence", () => {
    expect(cadenceSummary([])).toEqual({ totalEvents: 0, activeDays: 0, streak: 0 });
  });
});

describe("anchoredPct", () => {
  it("rounds the anchored share to whole percent", () => {
    expect(anchoredPct(119, 156)).toBe(76);
    expect(anchoredPct(9, 10)).toBe(90);
    expect(anchoredPct(0, 10)).toBe(0);
    expect(anchoredPct(10, 10)).toBe(100);
  });

  it("is null when there are no quotes (unknown, not zero)", () => {
    expect(anchoredPct(0, 0)).toBeNull();
  });
});

describe("classifyMomentum", () => {
  it("quiet when both windows are empty", () => {
    expect(classifyMomentum(0, 0)).toBe("quiet");
  });
  it("rising from zero or up ≥25%", () => {
    expect(classifyMomentum(3, 0)).toBe("rising");
    expect(classifyMomentum(10, 8)).toBe("rising"); // 1.25×
  });
  it("cooling when down ≥25% (including to zero)", () => {
    expect(classifyMomentum(6, 8)).toBe("cooling"); // 0.75×
    expect(classifyMomentum(0, 5)).toBe("cooling");
  });
  it("steady in between", () => {
    expect(classifyMomentum(9, 8)).toBe("steady");
    expect(classifyMomentum(7, 8)).toBe("steady");
  });
});

describe("buildStatsOverview", () => {
  const sessionRows = [
    { sessionId: "a", moments: 71, quotes: 156, anchored: 119, supported: 16, contradicted: 1 },
    { sessionId: "b", moments: 45, quotes: 90, anchored: 71, supported: 12, contradicted: 0 },
    { sessionId: "c", moments: 0, quotes: 0, anchored: 0, supported: 0, contradicted: 0 },
  ];

  it("attaches per-session anchoredPct (null when no quotes)", () => {
    const o = buildStatsOverview({ cadenceRows: [], sessionRows, featureRows: [], now: NOW });
    expect(o.sessions.find((s) => s.sessionId === "a")?.anchoredPct).toBe(76);
    expect(o.sessions.find((s) => s.sessionId === "b")?.anchoredPct).toBe(79);
    expect(o.sessions.find((s) => s.sessionId === "c")?.anchoredPct).toBeNull();
  });

  it("aggregates the record from raw counts, not from rounded percents", () => {
    const o = buildStatsOverview({ cadenceRows: [], sessionRows, featureRows: [], now: NOW });
    expect(o.record).toEqual({
      sessions: 3,
      moments: 116,
      quotes: 246,
      anchored: 190,
      anchoredPct: 77, // 190/246 = 77.2 → 77
      supported: 28,
      contradicted: 1,
    });
  });

  it("classifies feature momentum", () => {
    const o = buildStatsOverview({
      cadenceRows: [],
      sessionRows: [],
      featureRows: [
        { featureId: "f1", recentEvents: 9, priorEvents: 2, lastActivity: "2026-07-03T00:00:00Z" },
        { featureId: "f2", recentEvents: 0, priorEvents: 0, lastActivity: null },
      ],
      now: NOW,
    });
    expect(o.features[0].trend).toBe("rising");
    expect(o.features[1].trend).toBe("quiet");
  });

  it("densifies cadence and summarizes it", () => {
    const o = buildStatsOverview({
      cadenceRows: [
        { day: "2026-07-04", events: 22 },
        { day: "2026-07-03", events: 178 },
      ],
      sessionRows: [],
      featureRows: [],
      now: NOW,
    });
    expect(o.cadence).toHaveLength(14);
    expect(o.cadenceSummary).toEqual({ totalEvents: 200, activeDays: 2, streak: 2 });
  });
});

describe("emptyStatsOverview", () => {
  it("serves a dense zero shape (fail-safe, never a 500)", () => {
    const o = emptyStatsOverview(14, NOW);
    expect(o.cadence).toHaveLength(14);
    expect(o.cadence.every((d) => d.events === 0)).toBe(true);
    expect(o.record.anchoredPct).toBeNull();
    expect(o.sessions).toEqual([]);
    expect(o.features).toEqual([]);
  });
});
