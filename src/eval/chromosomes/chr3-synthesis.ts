import type { SynthesisAllele, SynthesizedData, EnrichedExchange } from "./types.js";
import type { NormalizedDevEvent, TurnExchange } from "../../adapters/types.js";
import { analyzeInteractions } from "../../pipeline/analyze.js";
import { classifyExchanges, type ExchangeClassification } from "../../pipeline/classify-exchanges.js";

// ── 3a: No Synthesis (raw events only) ──────────────────────────────

export const noSynthesis: SynthesisAllele = {
  name: "3a_none",
  process(events: NormalizedDevEvent[]): SynthesizedData {
    const directives = analyzeInteractions(events);
    return { exchanges: [], directives };
  },
};

// ── 3b: Exchange Pairs (reuses existing analyzeInteractions) ────────

export const exchangePairs: SynthesisAllele = {
  name: "3b_exchange_pairs",
  process(events: NormalizedDevEvent[]): SynthesizedData {
    const directives = analyzeInteractions(events);
    const exchanges = buildExchanges(events);
    return { exchanges, directives };
  },
};

// ── 3c: Full Pre-compute (Haiku-powered) ───────────────────────────
// Exchange pairs + Haiku semantic classification + deterministic
// topic fingerprints from file paths + smart quote extraction

export const fullPrecompute: SynthesisAllele = {
  name: "3c_full_precompute",
  async process(events: NormalizedDevEvent[]): Promise<SynthesizedData> {
    const directives = analyzeInteractions(events);
    const exchanges = buildExchanges(events);

    // Semantic classification via Haiku (replaces regex)
    const classifications = await classifyExchanges(exchanges);

    // Combine Haiku classification with deterministic enrichment
    const enrichedExchanges = exchanges.map((ex, i) => {
      const cls = classifications[i];
      return {
        devEvent: ex.devEvent,
        aiTurnEvents: ex.aiTurnEvents,
        agency: cls?.agency ?? "ambiguous",
        candidateType: cls?.candidateType ?? null,
        topicFingerprint: computeTopicFingerprint(ex),
        notableQuotes: extractNotableQuotes(ex, cls),
      };
    });

    return { exchanges, directives, enrichedExchanges };
  },
};

// ── Exchange building (shared) ──────────────────────────────────────

function buildExchanges(events: NormalizedDevEvent[]): TurnExchange[] {
  const exchanges: TurnExchange[] = [];

  const intentIndices: number[] = [];
  for (let i = 0; i < events.length; i++) {
    if (events[i].category === "intent") {
      intentIndices.push(i);
    }
  }

  for (let k = 0; k < intentIndices.length; k++) {
    const devIdx = intentIndices[k];
    const devEvent = events[devIdx];
    const nextIntentIdx =
      k + 1 < intentIndices.length ? intentIndices[k + 1] : events.length;

    const aiTurnEvents = events.slice(devIdx + 1, nextIntentIdx);

    const devDetail = devEvent.content.detail;
    const devResponseChars = devDetail.length;
    const devAskedQuestion = devDetail.includes("?");
    const devUsedReasoning = false; // Determined by Haiku classifier, not regex

    exchanges.push({
      devEvent,
      aiTurnEvents,
      devResponseChars,
      devAskedQuestion,
      devUsedReasoning,
      devIntroducedNewTopic: false, // simplified for chromosome eval
      aiProposedMultipleOptions: false,
      devRespondedToAllOptions: false,
    });
  }

  return exchanges;
}

// ── Enrichment helpers ──────────────────────────────────────────────
// (Old regex-based computeAgency and computeCandidateType removed.
//  3c now uses Haiku classification via classifyExchanges.)

/**
 * Topic fingerprint from file paths in the exchange.
 * Uses directory structure (most meaningful) rather than filename.
 * Examples:
 *   src/pipeline/normalize.ts → "pipeline"
 *   src/llm/prompts/moments.ts → "llm-prompts"
 *   tests/eval/fixtures/scope-design.jsonl → "eval-fixtures"
 *   src/adapters/types.ts → "adapters"
 */
function computeTopicFingerprint(ex: TurnExchange): string {
  // Collect all file paths from the exchange
  const allFiles: string[] = [];
  if (ex.devEvent.content.filesAffected) {
    allFiles.push(...ex.devEvent.content.filesAffected);
  }
  for (const ae of ex.aiTurnEvents) {
    if (ae.content.filesAffected) {
      allFiles.push(...ae.content.filesAffected);
    }
  }

  if (allFiles.length === 0) {
    // No files — derive from developer's message content
    return deriveTopicFromContent(ex);
  }

  // Extract meaningful directory segments, ignoring noise
  const segments = allFiles
    .map(extractMeaningfulSegment)
    .filter(Boolean) as string[];

  if (segments.length === 0) return "general";

  // Most common segment wins
  const counts = new Map<string, number>();
  for (const s of segments) {
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }

  let best = segments[0];
  let bestCount = 0;
  for (const [seg, count] of counts) {
    if (count > bestCount) {
      best = seg;
      bestCount = count;
    }
  }

  return best;
}

/**
 * Extract the most meaningful directory segment from a file path.
 * Skips generic prefixes (src/, tests/, docs/) and returns the
 * domain-level directory.
 */
function extractMeaningfulSegment(filePath: string): string | null {
  // Normalize: remove leading /, project root noise
  const normalized = filePath
    .replace(/^\/[^/]+\/[^/]+\/dev\/[^/]+\//, "") // strip absolute prefix
    .replace(/^\.\//, "");

  const parts = normalized.split("/").filter(Boolean);

  // Skip generic top-level dirs
  const skipPrefixes = ["src", "tests", "test", "docs", "lib", "dist", "build"];
  let meaningful = parts.filter((p) => !skipPrefixes.includes(p));

  // Take the first meaningful directory (not the filename)
  if (meaningful.length > 1) {
    // Drop the filename, take the deepest directory
    meaningful = meaningful.slice(0, -1);
  }

  if (meaningful.length === 0) {
    // All parts were generic — use the second part of the original
    if (parts.length >= 2) return parts[1];
    return null;
  }

  // Join up to 2 levels: "pipeline" or "llm-prompts" or "eval-fixtures"
  return meaningful
    .slice(0, 2)
    .join("-")
    .replace(/[._]/g, "-")
    .toLowerCase();
}

/**
 * Derive topic from developer message content when no files are present.
 * Uses the first substantive noun phrase, not a keyword list.
 */
function deriveTopicFromContent(ex: TurnExchange): string {
  const devText = ex.devEvent.content.detail.toLowerCase();

  // If developer mentions specific technical concepts, use them
  // But do this from the actual content, not a hardcoded list
  const words = devText
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3);

  // Skip common stop words
  const stopWords = new Set([
    "this", "that", "with", "from", "have", "will", "would", "could",
    "should", "what", "when", "where", "which", "about", "also",
    "just", "like", "some", "more", "than", "then", "very", "been",
    "into", "only", "your", "they", "them", "their", "does", "don't",
    "want", "need", "make", "sure", "think", "know", "look", "good",
    "well", "okay", "right", "actually", "because", "instead",
  ]);

  const meaningfulWords = words.filter((w) => !stopWords.has(w));

  if (meaningfulWords.length > 0) {
    return meaningfulWords[0];
  }

  return "general";
}

/**
 * Extract notable quotes from the exchange.
 * Selects the most meaningful quotes, not just first/longest.
 * Uses the classification to know what kind of quote to look for.
 */
function extractNotableQuotes(
  ex: TurnExchange,
  classification?: ExchangeClassification | null,
): { speaker: "dev" | "ai"; text: string }[] {
  const quotes: { speaker: "dev" | "ai"; text: string }[] = [];

  const devText = ex.devEvent.content.detail;

  // Developer quote — always include if substantive
  if (devText.length > 5) {
    if (devText.length <= 300) {
      // Short enough to include verbatim
      quotes.push({ speaker: "dev", text: devText });
    } else {
      // Long — extract the most meaningful sentence
      quotes.push({ speaker: "dev", text: extractKeySentence(devText) });
    }
  }

  // AI quote — pick based on what's happening in this exchange
  const aiProposals = ex.aiTurnEvents.filter((e) => e.category === "proposal");
  const aiReflections = ex.aiTurnEvents.filter((e) => e.category === "reflection");
  const aiActions = ex.aiTurnEvents.filter((e) => e.category === "action");

  if (classification?.intent === "rejection" || classification?.intent === "challenge") {
    // Developer pushed back — include the AI proposal they rejected
    const rejected = aiProposals[0] ?? aiReflections[0];
    if (rejected) {
      quotes.push({ speaker: "ai", text: extractFirstSentence(rejected.content.detail) });
    }
  } else if (classification?.candidateType === "discovery") {
    // Discovery — include the AI's reflection that revealed new info
    const discovery = aiReflections[0] ?? aiProposals[0];
    if (discovery) {
      quotes.push({ speaker: "ai", text: extractFirstSentence(discovery.content.detail) });
    }
  } else if (aiProposals.length > 0) {
    // Default — include first AI proposal sentence
    quotes.push({ speaker: "ai", text: extractFirstSentence(aiProposals[0].content.detail) });
  }

  // Action summary if the AI did something concrete
  if (aiActions.length > 0) {
    const actionSummary = aiActions
      .map((a) => a.content.summary)
      .slice(0, 3)
      .join(", ");
    quotes.push({ speaker: "ai", text: `[Actions: ${actionSummary}]` });
  }

  return quotes;
}

/**
 * Extract the first meaningful sentence from text.
 */
function extractFirstSentence(text: string): string {
  // Split on sentence boundaries
  const sentences = text.split(/[.!?]\s+/);
  const first = sentences[0] ?? text;
  return first.length > 200 ? first.slice(0, 200) + "..." : first + ".";
}

/**
 * Extract the most "decisive" sentence from a long developer message.
 * Looks for sentences with strong language: "I want", "let's", "we should", "actually", etc.
 */
function extractKeySentence(text: string): string {
  const sentences = text.split(/[.!?]\s+/).filter((s) => s.length > 10);

  // Score each sentence by "decisiveness"
  const scored = sentences.map((s) => {
    let score = 0;
    const lower = s.toLowerCase();
    if (lower.includes("i want") || lower.includes("i prefer")) score += 3;
    if (lower.includes("let's") || lower.includes("we should")) score += 2;
    if (lower.includes("actually") || lower.includes("instead")) score += 2;
    if (lower.includes("not") || lower.includes("don't")) score += 1;
    if (s.includes("?")) score += 1;
    // Longer = more informative
    score += Math.min(s.length / 50, 2);
    return { sentence: s, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0]?.sentence ?? text.slice(0, 200);
  return best.length > 200 ? best.slice(0, 200) + "..." : best;
}

// ── 3e: Haiku-Classified (LLM replaces regex heuristics) ────────────
// Uses Haiku to classify exchanges instead of regex patterns.
// Replaces computeAgency + computeCandidateType with semantic classification.

// 3e is now identical to 3c (both use Haiku). Kept as alias for backward compat.
export const haikuClassified: SynthesisAllele = fullPrecompute;
