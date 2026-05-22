import type { NormalizedDevEvent, SessionChunk } from "../adapters/types.js";

// ── Constants ────────────────────────────────────────────────────────

const PAUSE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const FILE_SHIFT_THRESHOLD = 0.7; // 70% new files
const MIN_PREVIOUS_FILES = 3; // need enough file context to detect a real shift
const MIN_CURRENT_FILES = 1; // at least one file needed
const MIN_CHUNK_SIZE = 8; // merge tiny chunks into neighbors
const SIZE_CAP = 80;
const OVERLAP = 3;
const SHORT_SESSION_THRESHOLD = 10;

// Ignore files outside the project — skill docs, tmp files, etc.
const IGNORED_FILE_PATTERNS = [
  /\/\.claude\//,
  /\/node_modules\//,
  /^\/tmp\//,
  /^\/private\/tmp\//,
];

const TOPIC_SHIFT_PATTERNS = [
  /\bnow let'?s\b/i,
  /\bmoving on\b/i,
  /\bswitch to\b/i,
  /\bok let'?s work on\b/i,
  /\bok\s+next\b/i,
  /\blet'?s move on\b/i,
];

// ── Main Entry Point ─────────────────────────────────────────────────

/**
 * Split a session's normalized events into bounded reasoning windows (chunks).
 * Deterministic — no LLM calls.
 */
export function chunkSession(
  events: NormalizedDevEvent[],
  sessionId: string,
): SessionChunk[] {
  if (events.length === 0) return [];

  // Short sessions: one chunk, no splitting
  if (events.length < SHORT_SESSION_THRESHOLD) {
    return [buildChunk(events, sessionId, 0, [])];
  }

  // Find all split points
  const splitIndices = findSplitPoints(events);

  // Build chunks from split points
  const rawChunks = splitAtIndices(events, splitIndices);

  // Merge tiny chunks into neighbors
  const mergedChunks = mergeTinyChunks(rawChunks);

  // Apply size cap to oversized chunks
  const cappedChunks = mergedChunks.flatMap((chunk) => applySizeCap(chunk));

  // Build SessionChunk objects with overlap
  return buildChunksWithOverlap(cappedChunks, sessionId);
}

// ── Split Point Detection ────────────────────────────────────────────

/**
 * Find indices where the event list should be split.
 * A split index N means: chunk boundary between events[N-1] and events[N].
 */
function findSplitPoints(events: NormalizedDevEvent[]): number[] {
  const splits: number[] = [];
  let lastSplit = 0; // Enforce minimum gap between splits

  for (let i = 1; i < events.length; i++) {
    // Don't split if we're too close to the last split
    if (i - lastSplit < MIN_CHUNK_SIZE) continue;

    // Priority 1: Large pauses (>5 min gap)
    const gap =
      new Date(events[i].timestamp).getTime() -
      new Date(events[i - 1].timestamp).getTime();
    if (gap > PAUSE_THRESHOLD_MS) {
      splits.push(i);
      lastSplit = i;
      continue;
    }

    // Priority 2: File cluster shift
    if (hasFileClusterShift(events, i)) {
      splits.push(i);
      lastSplit = i;
      continue;
    }

    // Priority 3: Explicit topic shift in user messages
    if (hasTopicShift(events[i])) {
      splits.push(i);
      lastSplit = i;
    }
  }

  return splits;
}

/**
 * Check if the forward window of files at index i represents a cluster shift
 * compared to the preceding window.
 *
 * Compares files from events[index..index+LOOKAHEAD] against
 * files from events[index-LOOKBACK..index-1].
 * Triggers when >70% of the forward window's files are new.
 */
function hasFileClusterShift(
  events: NormalizedDevEvent[],
  index: number,
): boolean {
  const LOOKAHEAD = 5;
  const LOOKBACK = 15;

  // Collect files from forward window (current + next few events)
  const forwardEnd = Math.min(events.length, index + LOOKAHEAD);
  const forwardFiles = new Set<string>();
  for (let j = index; j < forwardEnd; j++) {
    for (const f of getProjectFiles(events[j])) {
      forwardFiles.add(f);
    }
  }
  if (forwardFiles.size < MIN_CURRENT_FILES) return false;

  // Collect files from the preceding window
  const lookbackStart = Math.max(0, index - LOOKBACK);
  const previousFiles = new Set<string>();
  for (let j = lookbackStart; j < index; j++) {
    for (const f of getProjectFiles(events[j])) {
      previousFiles.add(f);
    }
  }

  if (previousFiles.size < MIN_PREVIOUS_FILES) return false;

  // Check what percentage of forward files are new
  const forwardArr = [...forwardFiles];
  const newFiles = forwardArr.filter((f) => !previousFiles.has(f));
  return newFiles.length / forwardArr.length > FILE_SHIFT_THRESHOLD;
}

/**
 * Check if an event contains an explicit topic shift phrase.
 */
function hasTopicShift(event: NormalizedDevEvent): boolean {
  if (event.category !== "intent") return false;
  const text = event.content.detail;
  return TOPIC_SHIFT_PATTERNS.some((p) => p.test(text));
}

// ── Merge Tiny Chunks ────────────────────────────────────────────────

/**
 * Merge chunks smaller than MIN_CHUNK_SIZE into their preceding neighbor.
 * If the first chunk is tiny, merge it into the next one.
 */
function mergeTinyChunks(
  chunks: NormalizedDevEvent[][],
): NormalizedDevEvent[][] {
  if (chunks.length <= 1) return chunks;

  const result: NormalizedDevEvent[][] = [chunks[0]];

  for (let i = 1; i < chunks.length; i++) {
    if (chunks[i].length < MIN_CHUNK_SIZE) {
      // Merge into the previous chunk
      result[result.length - 1] = [
        ...result[result.length - 1],
        ...chunks[i],
      ];
    } else {
      result.push(chunks[i]);
    }
  }

  // If the first chunk ended up tiny (from being the original first), merge forward
  if (result.length > 1 && result[0].length < MIN_CHUNK_SIZE) {
    result[1] = [...result[0], ...result[1]];
    result.shift();
  }

  return result;
}

// ── Chunk Building ───────────────────────────────────────────────────

/**
 * Split events array at the given indices into sub-arrays.
 */
function splitAtIndices(
  events: NormalizedDevEvent[],
  indices: number[],
): NormalizedDevEvent[][] {
  if (indices.length === 0) return [events];

  const chunks: NormalizedDevEvent[][] = [];
  let start = 0;

  for (const idx of indices) {
    if (idx > start) {
      chunks.push(events.slice(start, idx));
    }
    start = idx;
  }

  // Remaining events after the last split
  if (start < events.length) {
    chunks.push(events.slice(start));
  }

  return chunks;
}

/**
 * If a chunk exceeds SIZE_CAP, split it at natural boundaries.
 */
function applySizeCap(events: NormalizedDevEvent[]): NormalizedDevEvent[][] {
  if (events.length <= SIZE_CAP) return [events];

  const result: NormalizedDevEvent[][] = [];
  let start = 0;

  while (start < events.length) {
    if (events.length - start <= SIZE_CAP) {
      result.push(events.slice(start));
      break;
    }

    // Find the nearest natural boundary around SIZE_CAP
    const target = start + SIZE_CAP;
    const splitAt = findNaturalBoundary(events, target);
    result.push(events.slice(start, splitAt));
    start = splitAt;
  }

  return result;
}

/**
 * Find a natural boundary near the target index.
 * Prefer splitting after a tool_result or before a conversation_turn.
 * Search within +/- 10 events of target.
 */
function findNaturalBoundary(
  events: NormalizedDevEvent[],
  target: number,
): number {
  const searchRadius = 10;
  const lo = Math.max(1, target - searchRadius);
  const hi = Math.min(events.length, target + searchRadius);

  // Prefer: after tool_result (split at i+1)
  for (let i = target; i >= lo; i--) {
    if (events[i - 1]?.category === "result") return i;
  }
  for (let i = target + 1; i < hi; i++) {
    if (events[i - 1]?.category === "result") return i;
  }

  // Fallback: before conversation_turn
  for (let i = target; i >= lo; i--) {
    if (events[i]?.category === "intent") return i;
  }
  for (let i = target + 1; i < hi; i++) {
    if (events[i]?.category === "intent") return i;
  }

  // Last resort: split at target
  return Math.min(target, events.length);
}

/**
 * Build final SessionChunk objects with overlap between consecutive chunks.
 */
function buildChunksWithOverlap(
  rawChunks: NormalizedDevEvent[][],
  sessionId: string,
): SessionChunk[] {
  const result: SessionChunk[] = [];

  for (let i = 0; i < rawChunks.length; i++) {
    const ownedEvents = rawChunks[i];
    // Prepend overlap from previous chunk (last OVERLAP events)
    const overlapEvents =
      i > 0 ? rawChunks[i - 1].slice(-OVERLAP) : [];

    result.push(buildChunk(ownedEvents, sessionId, i, overlapEvents));
  }

  return result;
}

/**
 * Build a single SessionChunk from owned events and optional overlap events.
 */
function buildChunk(
  ownedEvents: NormalizedDevEvent[],
  sessionId: string,
  chunkIndex: number,
  overlapEvents: NormalizedDevEvent[],
): SessionChunk {
  const allEvents = [...overlapEvents, ...ownedEvents];

  const startCausalOrder = ownedEvents[0].causalOrder;
  const endCausalOrder = ownedEvents[ownedEvents.length - 1].causalOrder;

  return {
    id: `${sessionId}-chunk-${chunkIndex}`,
    sessionId,
    chunkIndex,
    events: allEvents,
    topicHint: deriveTopicHint(ownedEvents),
    filesInScope: deriveFilesInScope(allEvents),
    eventRange: [startCausalOrder, endCausalOrder],
  };
}

// ── Topic Hint & Files ───────────────────────────────────────────────

/**
 * Derive a topic hint from the chunk's owned events.
 * Heuristic: most frequent directory/filename from filesAffected,
 * falling back to first user message summary.
 */
function deriveTopicHint(events: NormalizedDevEvent[]): string {
  // Count file path frequency
  const freq = new Map<string, number>();
  for (const event of events) {
    for (const file of getFilesAffected(event)) {
      freq.set(file, (freq.get(file) ?? 0) + 1);
    }
  }

  if (freq.size > 0) {
    // Return the most frequent file path
    let best = "";
    let bestCount = 0;
    for (const [file, count] of freq) {
      if (count > bestCount) {
        best = file;
        bestCount = count;
      }
    }
    return best;
  }

  // Fallback: first user message summary
  const userEvent = events.find((e) => e.category === "intent");
  if (userEvent) {
    return userEvent.content.summary;
  }

  return "unknown";
}

/**
 * Collect all unique files from events' filesAffected.
 */
function deriveFilesInScope(events: NormalizedDevEvent[]): string[] {
  const files = new Set<string>();
  for (const event of events) {
    for (const f of getFilesAffected(event)) {
      files.add(f);
    }
  }
  return Array.from(files);
}

/**
 * Get filesAffected from an event, defaulting to empty array.
 */
function getFilesAffected(event: NormalizedDevEvent): string[] {
  return event.content.filesAffected ?? [];
}

/**
 * Get only project-relevant files (filter out skill docs, tmp, node_modules).
 * Used for file cluster shift detection — we don't want reading a skill doc
 * to trigger a chunk split.
 */
function getProjectFiles(event: NormalizedDevEvent): string[] {
  return getFilesAffected(event).filter(
    (f) => !IGNORED_FILE_PATTERNS.some((p) => p.test(f)),
  );
}
