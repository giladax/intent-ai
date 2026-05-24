/**
 * String-similarity based deduplication for brain insights.
 * Uses multiset Dice coefficient + containment scoring (no external deps).
 */

// Common stop words to ignore in token comparison
const STOP_WORDS = new Set([
  "the", "and", "for", "are", "was", "were", "has", "have", "had",
  "will", "would", "could", "should", "may", "might", "must", "can",
  "not", "but", "with", "that", "this", "from", "all", "its", "use",
  "used", "uses", "over", "into", "also", "than", "one", "two", "new",
  "per", "via", "etc", "non",
]);

function tokenize(text: string): string[] {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

/**
 * Prefix-normalize a token to handle common morphological variants.
 * e.g., "streaming" -> "stream", "processes" -> "process"
 */
function normalize(token: string): string {
  // Simple suffix stripping for common English patterns (order matters: longest first)
  if (token.endsWith("tions") && token.length > 7) return token.slice(0, -5);
  if (token.endsWith("tion") && token.length > 6) return token.slice(0, -4);
  if (token.endsWith("ments") && token.length > 7) return token.slice(0, -5);
  if (token.endsWith("ment") && token.length > 6) return token.slice(0, -4);
  if (token.endsWith("ness") && token.length > 6) return token.slice(0, -4);
  if (token.endsWith("ing") && token.length > 5) return token.slice(0, -3);
  if (token.endsWith("ies") && token.length > 5) return token.slice(0, -3) + "y";
  if (token.endsWith("es") && token.length > 4) return token.slice(0, -2);
  if (token.endsWith("ed") && token.length > 4) return token.slice(0, -2);
  if (token.endsWith("s") && token.length > 3) return token.slice(0, -1);
  return token;
}

/** Build a frequency map from a token list. */
function multisetCount(tokens: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tokens) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

/** Multiset intersection size: sum of min(count_a, count_b) over shared keys. */
function multisetIntersectionSize(a: Map<string, number>, b: Map<string, number>): number {
  let count = 0;
  for (const [t, n] of a) {
    const nb = b.get(t);
    if (nb) count += Math.min(n, nb);
  }
  return count;
}

/**
 * Compute similarity between two insight statements.
 * Returns 0-1 score. >0.7 indicates likely duplicate.
 *
 * Combines:
 * - Multiset Dice coefficient: accounts for repeated important terms
 *   (e.g., "client.messages" repeated in context of streaming API)
 * - Containment score with non-linear boost: detects subset statements
 *   (short statement whose key terms all appear in a longer one)
 *
 * The non-linear boost on high containment (>= 0.9) ensures that a short
 * statement fully contained in a longer one scores well above 0.7 even
 * when Dice is low due to the many extra tokens in the longer statement.
 */
export function computeSimilarity(a: string, b: string): number {
  const rawA = tokenize(a);
  const rawB = tokenize(b);

  if (rawA.length === 0 || rawB.length === 0) return 0;

  const normA = rawA.map(normalize);
  const normB = rawB.map(normalize);

  // Multiset Dice: 2 * |intersection| / (|A| + |B|)
  const mapA = multisetCount(normA);
  const mapB = multisetCount(normB);
  const inter = multisetIntersectionSize(mapA, mapB);
  const dice = (2 * inter) / (normA.length + normB.length);

  // Containment on unique token sets (subset detection)
  const setA = new Set(normA);
  const setB = new Set(normB);
  const smaller = setA.size <= setB.size ? setA : setB;
  const larger = setA.size > setB.size ? setB : setA;
  const rawContainment = smaller.size > 0
    ? [...smaller].filter((t) => larger.has(t)).length / smaller.size
    : 0;

  // Non-linear boost: high containment (full subset) gets squared — pushes
  // e.g. containment=1.0 from contributing 0.65 to contributing 0.65 of 1.0
  const containment = rawContainment >= 0.9 ? rawContainment * rawContainment : rawContainment;

  // Weighted combination: containment dominates for subset detection,
  // Dice captures rephrased-same-concept via repeated shared terms
  return dice * 0.35 + containment * 0.65;
}

/**
 * Given a list of insights, return indices of duplicates to remove.
 * Keeps the one with higher confidence (or first if equal).
 */
export function findDuplicateIndices(
  insights: { statement: string; confidence: number }[],
  threshold = 0.7,
): Set<number> {
  const toRemove = new Set<number>();

  for (let i = 0; i < insights.length; i++) {
    if (toRemove.has(i)) continue;
    for (let j = i + 1; j < insights.length; j++) {
      if (toRemove.has(j)) continue;
      const score = computeSimilarity(insights[i].statement, insights[j].statement);
      if (score >= threshold) {
        // Remove the one with lower confidence
        if (insights[j].confidence > insights[i].confidence) {
          toRemove.add(i);
          break; // i is removed, stop comparing it
        } else {
          toRemove.add(j);
        }
      }
    }
  }

  return toRemove;
}
