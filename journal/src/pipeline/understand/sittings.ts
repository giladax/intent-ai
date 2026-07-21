import type { NormalizedDevEvent, Sitting } from "../../adapters/types.js";

export const SITTING_GAP_MS = 30 * 60 * 1000;

/**
 * Segment a sorted-by-causalOrder event list into "sittings" (contiguous work
 * sessions separated by idle gaps >= SITTING_GAP_MS).
 *
 * Rules:
 * - Sort-stable walk in causalOrder order.
 * - A gap >= SITTING_GAP_MS between consecutive event timestamps closes the
 *   current sitting and opens a new one.
 * - Events with missing/unparseable timestamps inherit the previous event's
 *   resolved timestamp for gap purposes (never crash).
 * - Empty input → [].
 */
export function detectSittings(events: NormalizedDevEvent[]): Sitting[] {
  if (events.length === 0) return [];

  const sorted = [...events].sort((a, b) => a.causalOrder - b.causalOrder);

  const sittings: Sitting[] = [];

  let sittingIndex = 0;
  let sittingStart = sorted[0].causalOrder;
  let sittingStartTs = sorted[0].timestamp;
  let prevTs = parseTs(sorted[0].timestamp, null);

  for (let i = 1; i < sorted.length; i++) {
    const ev = sorted[i];
    const ts = parseTs(ev.timestamp, prevTs);
    const gap = prevTs !== null && ts !== null ? ts - prevTs : 0;

    if (gap >= SITTING_GAP_MS) {
      // Close current sitting
      sittings.push({
        sittingIndex,
        startedAt: sittingStartTs,
        endedAt: sorted[i - 1].timestamp,
        eventRange: [sittingStart, sorted[i - 1].causalOrder],
      });
      sittingIndex++;
      sittingStart = ev.causalOrder;
      sittingStartTs = ev.timestamp;
    }

    if (ts !== null) prevTs = ts;
  }

  // Close the last sitting
  sittings.push({
    sittingIndex,
    startedAt: sittingStartTs,
    endedAt: sorted[sorted.length - 1].timestamp,
    eventRange: [sittingStart, sorted[sorted.length - 1].causalOrder],
  });

  return sittings;
}

function parseTs(iso: string, fallback: number | null): number | null {
  const ms = Date.parse(iso);
  return isNaN(ms) ? fallback : ms;
}
