import { describe, it, expect } from "vitest";
import { toneOfPct, sparkHeights, relDay, cadenceCaption } from "./quality-util";

describe("toneOfPct", () => {
  it("bands anchored percent into tones", () => {
    expect(toneOfPct(90)).toBe("high");
    expect(toneOfPct(75)).toBe("high");
    expect(toneOfPct(74)).toBe("mid");
    expect(toneOfPct(45)).toBe("mid");
    expect(toneOfPct(44)).toBe("low");
    expect(toneOfPct(0)).toBe("low");
  });
  it("null (no evidence) is toneless, not low", () => {
    expect(toneOfPct(null)).toBe("none");
  });
});

describe("sparkHeights", () => {
  const day = (events: number) => ({ day: "d", events });

  it("scales on a square root so a loud day doesn't flatten the rest", () => {
    const h = sparkHeights([day(178), day(22), day(0)], 24);
    expect(h[0]).toBe(24); // the peak fills the strip
    expect(h[1]).toBe(Math.round(Math.sqrt(22 / 178) * 24)); // 8, not 3
    expect(h[2]).toBe(0); // quiet days stay a baseline tick
  });

  it("enforces a minimum visible height for any active day", () => {
    const h = sparkHeights([day(500), day(1)], 24);
    expect(h[1]).toBeGreaterThanOrEqual(3);
  });

  it("an all-quiet fortnight is all zeros", () => {
    expect(sparkHeights([day(0), day(0)], 24)).toEqual([0, 0]);
  });
});

describe("relDay", () => {
  const now = new Date(2026, 6, 4, 15, 0, 0); // Sat Jul 4
  it("labels recency in days", () => {
    expect(relDay("2026-07-04T09:00:00", now)).toBe("today");
    expect(relDay("2026-07-03T23:00:00", now)).toBe("1d ago");
    expect(relDay("2026-06-28T10:00:00", now)).toBe("6d ago");
  });
  it("falls back to a date beyond a week", () => {
    expect(relDay("2026-06-20T10:00:00", now)).toBe("Jun 20");
  });
  it("null / invalid input stays null", () => {
    expect(relDay(null, now)).toBeNull();
    expect(relDay("not-a-date", now)).toBeNull();
  });
});

describe("cadenceCaption", () => {
  it("reads as quiet chrome", () => {
    expect(cadenceCaption(384, 8, 2)).toBe("384 events · 8 active days · streak 2");
  });
  it("hides a trivial streak", () => {
    expect(cadenceCaption(1, 1, 1)).toBe("1 event · 1 active day");
  });
});
