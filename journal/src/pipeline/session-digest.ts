import type { SessionChunk, NormalizedDevEvent } from "../adapters/types.js";

// ── Session Digest ──────────────────────────────────────────────────
// Pre-computed cross-chunk context for moment detection.
// Entirely deterministic — no LLM calls.

export interface SessionDigest {
  /** All developer "intent" events with their chunk index. */
  developerStatements: {
    causalOrder: number;
    text: string;
    chunkIndex: number;
  }[];

  /** Topic flow across chunks (from chunk metadata). */
  topicFlow: {
    chunkIndex: number;
    topicHint: string;
    filesInScope: string[];
  }[];

  /** Events whose causal links span chunk boundaries. */
  boundaryExchanges: {
    chunkA: number;
    chunkB: number;
    eventIds: string[];
  }[];
}

/**
 * Build a SessionDigest from chunks and their source events.
 *
 * - Developer statements: events with `category === "intent"`, mapped to chunk index.
 * - Topic flow: lifted from chunk metadata.
 * - Boundary exchanges: events whose `respondingTo` or `turnId` spans two chunks.
 */
export function buildSessionDigest(
  chunks: SessionChunk[],
  events: NormalizedDevEvent[],
): SessionDigest {
  // ── Developer statements ──────────────────────────────────────────
  const developerStatements: SessionDigest["developerStatements"] = [];

  for (const chunk of chunks) {
    for (const ev of chunk.events) {
      if (ev.category === "intent") {
        developerStatements.push({
          causalOrder: ev.causalOrder,
          text: ev.content.detail || ev.content.summary,
          chunkIndex: chunk.chunkIndex,
        });
      }
    }
  }

  // ── Topic flow ────────────────────────────────────────────────────
  const topicFlow: SessionDigest["topicFlow"] = chunks.map((c) => ({
    chunkIndex: c.chunkIndex,
    topicHint: c.topicHint,
    filesInScope: c.filesInScope,
  }));

  // ── Boundary exchanges ────────────────────────────────────────────
  // Build a map: eventId → chunkIndex for fast lookup
  const eventToChunk = new Map<string, number>();
  for (const chunk of chunks) {
    for (const ev of chunk.events) {
      eventToChunk.set(ev.id, chunk.chunkIndex);
    }
  }

  // Build a map: turnId → set of chunk indices
  const turnIdChunks = new Map<string, Set<number>>();
  for (const chunk of chunks) {
    for (const ev of chunk.events) {
      if (ev.turnId) {
        if (!turnIdChunks.has(ev.turnId)) {
          turnIdChunks.set(ev.turnId, new Set());
        }
        turnIdChunks.get(ev.turnId)!.add(chunk.chunkIndex);
      }
    }
  }

  // Also index events by id for respondingTo lookups
  const eventById = new Map<string, NormalizedDevEvent>();
  for (const ev of events) {
    eventById.set(ev.id, ev);
  }

  // Deduplicate boundary pairs: key = "chunkA-chunkB"
  const boundaryMap = new Map<string, Set<string>>();

  // 1) respondingTo spanning chunks
  for (const chunk of chunks) {
    for (const ev of chunk.events) {
      if (ev.respondingTo) {
        const otherChunk = eventToChunk.get(ev.respondingTo);
        if (otherChunk !== undefined && otherChunk !== chunk.chunkIndex) {
          const [a, b] =
            otherChunk < chunk.chunkIndex
              ? [otherChunk, chunk.chunkIndex]
              : [chunk.chunkIndex, otherChunk];
          const key = `${a}-${b}`;
          if (!boundaryMap.has(key)) {
            boundaryMap.set(key, new Set());
          }
          boundaryMap.get(key)!.add(ev.id);
          boundaryMap.get(key)!.add(ev.respondingTo);
        }
      }
    }
  }

  // 2) turnId spanning chunks
  for (const [turnId, chunkSet] of turnIdChunks) {
    if (chunkSet.size > 1) {
      const sortedChunks = [...chunkSet].sort((a, b) => a - b);
      // Link adjacent pairs
      for (let i = 0; i < sortedChunks.length - 1; i++) {
        const a = sortedChunks[i];
        const b = sortedChunks[i + 1];
        const key = `${a}-${b}`;
        if (!boundaryMap.has(key)) {
          boundaryMap.set(key, new Set());
        }
        // Add all event ids with this turnId from both chunks
        for (const chunk of chunks) {
          if (chunk.chunkIndex === a || chunk.chunkIndex === b) {
            for (const ev of chunk.events) {
              if (ev.turnId === turnId) {
                boundaryMap.get(key)!.add(ev.id);
              }
            }
          }
        }
      }
    }
  }

  const boundaryExchanges: SessionDigest["boundaryExchanges"] = [];
  for (const [key, eventIds] of boundaryMap) {
    const [a, b] = key.split("-").map(Number);
    boundaryExchanges.push({
      chunkA: a,
      chunkB: b,
      eventIds: [...eventIds],
    });
  }

  // Sort by chunkA then chunkB
  boundaryExchanges.sort((a, b) => a.chunkA - b.chunkA || a.chunkB - b.chunkB);

  return { developerStatements, topicFlow, boundaryExchanges };
}
