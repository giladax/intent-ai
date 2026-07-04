/**
 * computeWindowMembership — pure, no DB, no LLM.
 *
 * Given the events for a session, the stored chunk owned-ranges, and the
 * pipeline's OVERLAP constant, returns a Map<causalOrder, chunkIndex[]>
 * with either 1 or 2 entries per event:
 *
 *   - 1 entry  → event falls squarely inside one window
 *   - 2 entries → event sits in the tail-overlap of chunk N AND chunk N+1
 *                 exists (i.e. it was prepended as context to the next window)
 */

interface EventLike {
  causalOrder: number;
}

interface ChunkLike {
  chunkIndex: number;
  eventRangeStart: number;
  eventRangeEnd: number;
}

export function computeWindowMembership(
  events: EventLike[],
  chunks: ChunkLike[],
  overlap: number,
): Map<number, number[]> {
  if (chunks.length === 0 || events.length === 0) return new Map();

  // Sort chunks by chunkIndex so we can find N+1 easily.
  const sorted = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);

  // Build a quick lookup: chunkIndex → next chunk (if any).
  const nextChunk = new Map<number, ChunkLike>();
  for (let i = 0; i < sorted.length - 1; i++) {
    nextChunk.set(sorted[i].chunkIndex, sorted[i + 1]);
  }

  const result = new Map<number, number[]>();

  for (const event of events) {
    const co = event.causalOrder;
    const memberships: number[] = [];

    for (const chunk of sorted) {
      if (co >= chunk.eventRangeStart && co <= chunk.eventRangeEnd) {
        memberships.push(chunk.chunkIndex);

        // Overlap rule: if this event is in the last `overlap` positions of
        // chunk N's owned range AND chunk N+1 exists, it also belongs to N+1.
        const overlapThreshold = chunk.eventRangeEnd - overlap + 1;
        if (co >= overlapThreshold && nextChunk.has(chunk.chunkIndex)) {
          const next = nextChunk.get(chunk.chunkIndex)!;
          memberships.push(next.chunkIndex);
        }
        // An event can only be owned by one chunk, so stop scanning.
        break;
      }
    }

    if (memberships.length > 0) {
      result.set(co, memberships);
    }
  }

  return result;
}
