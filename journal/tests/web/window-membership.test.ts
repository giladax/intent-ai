import { describe, it, expect } from "vitest";
import { computeWindowMembership } from "../../src/web/window-membership.js";

const OVERLAP = 3;

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeEvent(causalOrder: number) {
  return { causalOrder };
}

function makeChunk(
  chunkIndex: number,
  eventRangeStart: number,
  eventRangeEnd: number,
) {
  return { chunkIndex, eventRangeStart, eventRangeEnd };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("computeWindowMembership", () => {
  it("returns empty map when no chunks", () => {
    const events = [makeEvent(0), makeEvent(1)];
    const result = computeWindowMembership(events, [], OVERLAP);
    expect(result.size).toBe(0);
  });

  it("returns empty map when no events", () => {
    const chunks = [makeChunk(0, 0, 10)];
    const result = computeWindowMembership([], chunks, OVERLAP);
    expect(result.size).toBe(0);
  });

  it("mid-chunk event belongs to exactly one window", () => {
    // Chunk 0: causalOrder 0–12; Chunk 1: causalOrder 13–25
    // A mid-chunk event at causalOrder 5 (well before overlap threshold) → [0]
    const events = [makeEvent(5)];
    const chunks = [makeChunk(0, 0, 12), makeChunk(1, 13, 25)];
    const result = computeWindowMembership(events, chunks, OVERLAP);

    expect(result.get(5)).toEqual([0]);
  });

  it("event in last-OVERLAP positions of chunk N with a successor → two windows", () => {
    // Chunk 0: causalOrder 0–12, overlap threshold = 12-3+1 = 10
    // Chunk 1: causalOrder 13–25
    // Events at causalOrder 10, 11, 12 each belong to both [0] and [1]
    const events = [makeEvent(10), makeEvent(11), makeEvent(12)];
    const chunks = [makeChunk(0, 0, 12), makeChunk(1, 13, 25)];
    const result = computeWindowMembership(events, chunks, OVERLAP);

    expect(result.get(10)).toEqual([0, 1]);
    expect(result.get(11)).toEqual([0, 1]);
    expect(result.get(12)).toEqual([0, 1]);
  });

  it("final chunk's tail events belong to exactly one window (no successor)", () => {
    // Chunk 0: causalOrder 0–12 (the ONLY chunk)
    // Events at the tail (10, 11, 12) have no successor chunk → only [0]
    const events = [makeEvent(10), makeEvent(11), makeEvent(12)];
    const chunks = [makeChunk(0, 0, 12)];
    const result = computeWindowMembership(events, chunks, OVERLAP);

    expect(result.get(10)).toEqual([0]);
    expect(result.get(11)).toEqual([0]);
    expect(result.get(12)).toEqual([0]);
  });

  it("event just before overlap threshold belongs to one window only", () => {
    // Chunk 0: 0–12, overlap threshold = 10
    // Event at causalOrder 9 (one before threshold) → [0] only
    const events = [makeEvent(9)];
    const chunks = [makeChunk(0, 0, 12), makeChunk(1, 13, 25)];
    const result = computeWindowMembership(events, chunks, OVERLAP);

    expect(result.get(9)).toEqual([0]);
  });

  it("event not in any chunk range is absent from the map", () => {
    const events = [makeEvent(50)];
    const chunks = [makeChunk(0, 0, 12), makeChunk(1, 13, 25)];
    const result = computeWindowMembership(events, chunks, OVERLAP);

    expect(result.has(50)).toBe(false);
  });

  it("works across three chunks — middle chunk tail overlaps into third", () => {
    // Chunk 0: 0–9, Chunk 1: 10–19, Chunk 2: 20–29
    // overlap threshold for chunk 1: 19-3+1 = 17
    // Event at 17 → [1, 2]; event at 16 → [1] only; event at 19 → [1, 2]
    const events = [makeEvent(16), makeEvent(17), makeEvent(19)];
    const chunks = [makeChunk(0, 0, 9), makeChunk(1, 10, 19), makeChunk(2, 20, 29)];
    const result = computeWindowMembership(events, chunks, OVERLAP);

    expect(result.get(16)).toEqual([1]);
    expect(result.get(17)).toEqual([1, 2]);
    expect(result.get(19)).toEqual([1, 2]);
  });
});
