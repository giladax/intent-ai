import type { SessionChunk } from "../adapters/types.js";
import type { Pass1Moment } from "../llm/prompts/moments.js";

// ── Dedup Moments ───────────────────────────────────────────────────
// Deterministic pre-filter applied between pass 1 and pass 2.
// Reduces LLM work in pass 2 by removing obvious duplicates
// and flagging contradictions.

export interface DedupResult {
  /** Deduplicated moments per chunk, ready for pass 2. */
  moments: { chunkIndex: number; moments: Pass1Moment[] }[];

  /** Moments removed during dedup, with reason. */
  removed: {
    chunkIndex: number;
    moment: Pass1Moment;
    reason: string;
  }[];

  /** Moments at chunk boundaries with same topic — flag for pass 2. */
  boundaryMerges: {
    chunkA: number;
    chunkB: number;
    topicFingerprint: string;
    momentIndicesA: number[];
    momentIndicesB: number[];
  }[];

  /** Same sourceEventId but different agency across chunks. */
  contradictions: {
    eventId: string;
    entries: { chunkIndex: number; agency: string; momentIndex: number }[];
  }[];
}

/**
 * Deduplicate pass 1 moments before sending to pass 2.
 *
 * 1. Overlap dedup: same sourceEventId in adjacent chunks → keep the one
 *    with more evidence / higher confidence.
 * 2. Boundary merge flags: moments at chunk edges with matching topicFingerprint.
 * 3. Contradiction detection: same event cited with different agency.
 */
export function dedupMoments(
  pass1Results: { chunkIndex: number; moments: Pass1Moment[] }[],
  chunks: SessionChunk[],
): DedupResult {
  const removed: DedupResult["removed"] = [];
  const boundaryMerges: DedupResult["boundaryMerges"] = [];
  const contradictions: DedupResult["contradictions"] = [];

  // Working copy — we'll remove items from these arrays
  const working = pass1Results.map((r) => ({
    chunkIndex: r.chunkIndex,
    moments: [...r.moments],
  }));

  // ── 1. Overlap dedup: same sourceEventId in adjacent chunks ──────
  // Build index: sourceEventId → [{ chunkIndex, momentIndex, moment }]
  const eventIdIndex = new Map<
    string,
    { chunkIndex: number; momentIndex: number; moment: Pass1Moment }[]
  >();

  for (const result of working) {
    for (let mi = 0; mi < result.moments.length; mi++) {
      const m = result.moments[mi];
      const evidenceArray = Array.isArray(m.evidence) ? m.evidence : [];
      for (const ev of evidenceArray) {
        const eid = typeof ev === "string" ? undefined : (ev as { sourceEventId?: string }).sourceEventId;
        if (eid) {
          if (!eventIdIndex.has(eid)) {
            eventIdIndex.set(eid, []);
          }
          eventIdIndex.get(eid)!.push({
            chunkIndex: result.chunkIndex,
            momentIndex: mi,
            moment: m,
          });
        }
      }
    }
  }

  // Track moments to remove (by chunkIndex + momentIndex)
  const toRemove = new Set<string>();

  for (const [eventId, entries] of eventIdIndex) {
    if (entries.length < 2) continue;

    // Group by chunk
    const byChunk = new Map<number, typeof entries>();
    for (const entry of entries) {
      if (!byChunk.has(entry.chunkIndex)) {
        byChunk.set(entry.chunkIndex, []);
      }
      byChunk.get(entry.chunkIndex)!.push(entry);
    }

    // Only dedup across adjacent chunks
    const chunkIndices = [...byChunk.keys()].sort((a, b) => a - b);
    for (let i = 0; i < chunkIndices.length - 1; i++) {
      const cA = chunkIndices[i];
      const cB = chunkIndices[i + 1];
      if (cB - cA > 1) continue; // not adjacent

      const entriesA = byChunk.get(cA)!;
      const entriesB = byChunk.get(cB)!;

      // For each pair, keep the better one (more evidence, then higher confidence)
      for (const eA of entriesA) {
        for (const eB of entriesB) {
          const scoreA = momentScore(eA.moment);
          const scoreB = momentScore(eB.moment);

          if (scoreA >= scoreB) {
            const key = `${eB.chunkIndex}-${eB.momentIndex}`;
            if (!toRemove.has(key)) {
              toRemove.add(key);
              removed.push({
                chunkIndex: eB.chunkIndex,
                moment: eB.moment,
                reason: `duplicate of event ${eventId} in chunk ${eA.chunkIndex}`,
              });
            }
          } else {
            const key = `${eA.chunkIndex}-${eA.momentIndex}`;
            if (!toRemove.has(key)) {
              toRemove.add(key);
              removed.push({
                chunkIndex: eA.chunkIndex,
                moment: eA.moment,
                reason: `duplicate of event ${eventId} in chunk ${eB.chunkIndex}`,
              });
            }
          }
        }
      }
    }

    // ── 3. Contradiction detection ──────────────────────────────────
    const agencies = new Set(entries.map((e) => e.moment.agency));
    if (agencies.size > 1) {
      contradictions.push({
        eventId,
        entries: entries.map((e) => ({
          chunkIndex: e.chunkIndex,
          agency: e.moment.agency,
          momentIndex: e.momentIndex,
        })),
      });
    }
  }

  // Apply removals
  const moments = working.map((r) => ({
    chunkIndex: r.chunkIndex,
    moments: r.moments.filter(
      (_, mi) => !toRemove.has(`${r.chunkIndex}-${mi}`),
    ),
  }));

  // ── 2. Boundary merge flags ───────────────────────────────────────
  // Check last moments of chunk N vs first moments of chunk N+1
  // for matching topicFingerprint
  const sortedResults = [...moments].sort(
    (a, b) => a.chunkIndex - b.chunkIndex,
  );

  for (let i = 0; i < sortedResults.length - 1; i++) {
    const rA = sortedResults[i];
    const rB = sortedResults[i + 1];

    // Check if chunks are adjacent
    if (rB.chunkIndex - rA.chunkIndex > 1) continue;

    // Collect topic fingerprints from each chunk
    const topicsA = new Map<string, number[]>();
    for (let mi = 0; mi < rA.moments.length; mi++) {
      const fp = rA.moments[mi].topicFingerprint ?? "general";
      if (!topicsA.has(fp)) topicsA.set(fp, []);
      topicsA.get(fp)!.push(mi);
    }

    const topicsB = new Map<string, number[]>();
    for (let mi = 0; mi < rB.moments.length; mi++) {
      const fp = rB.moments[mi].topicFingerprint ?? "general";
      if (!topicsB.has(fp)) topicsB.set(fp, []);
      topicsB.get(fp)!.push(mi);
    }

    // Find shared topics (excluding "general")
    for (const [fp, indicesA] of topicsA) {
      if (fp === "general") continue;
      const indicesB = topicsB.get(fp);
      if (indicesB) {
        boundaryMerges.push({
          chunkA: rA.chunkIndex,
          chunkB: rB.chunkIndex,
          topicFingerprint: fp,
          momentIndicesA: indicesA,
          momentIndicesB: indicesB,
        });
      }
    }
  }

  return { moments, removed, boundaryMerges, contradictions };
}

// ── Internal ──────────────────────────────────────────────────────────

const CONFIDENCE_SCORES: Record<string, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

function momentScore(m: Pass1Moment): number {
  const evidenceCount = Array.isArray(m.evidence) ? m.evidence.length : 0;
  const confidenceScore = CONFIDENCE_SCORES[m.confidence] ?? 1;
  return evidenceCount * 2 + confidenceScore;
}
