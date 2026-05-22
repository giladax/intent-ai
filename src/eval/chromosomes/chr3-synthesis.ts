import type { SynthesisAllele, SynthesizedData, EnrichedExchange } from "./types.js";
import type { NormalizedDevEvent, TurnExchange } from "../../adapters/types.js";
import { analyzeInteractions } from "../../pipeline/analyze.js";

// ── 3b: Exchange Pairs (reuses existing analyzeInteractions) ────────

export const exchangePairs: SynthesisAllele = {
  name: "3b_exchange_pairs",
  process(events: NormalizedDevEvent[]): SynthesizedData {
    const directives = analyzeInteractions(events);
    const exchanges = buildExchanges(events);
    return { exchanges, directives };
  },
};

// ── 3c: Full Pre-compute ────────────────────────────────────────────
// Exchange pairs + deterministic agency + candidate types +
// topic fingerprints from file paths + notable quotes

export const fullPrecompute: SynthesisAllele = {
  name: "3c_full_precompute",
  process(events: NormalizedDevEvent[]): SynthesizedData {
    const directives = analyzeInteractions(events);
    const exchanges = buildExchanges(events);
    const enrichedExchanges = exchanges.map((ex) => enrichExchange(ex));
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
    const devUsedReasoning =
      /\b(because|actually|instead|but|however|rather)\b/i.test(devDetail);

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

// ── Enrichment (Chr 3c) ─────────────────────────────────────────────

function enrichExchange(ex: TurnExchange): EnrichedExchange {
  return {
    devEvent: ex.devEvent,
    aiTurnEvents: ex.aiTurnEvents,
    agency: computeAgency(ex),
    candidateType: computeCandidateType(ex),
    topicFingerprint: computeTopicFingerprint(ex),
    notableQuotes: extractNotableQuotes(ex),
  };
}

/**
 * Deterministic agency classification from exchange flags.
 */
function computeAgency(
  ex: TurnExchange,
): "developer" | "ai" | "collaborative" | "ambiguous" {
  const devChars = ex.devResponseChars;
  const asked = ex.devAskedQuestion;
  const reasoned = ex.devUsedReasoning;

  // Developer drove it: long response, reasoning, or introduced new topic
  if (reasoned || ex.devIntroducedNewTopic) {
    return "developer";
  }

  // Passive acceptance: very short response, no question, no reasoning
  if (devChars < 15 && !asked && !reasoned) {
    // Check if AI did significant work
    const aiActions = ex.aiTurnEvents.filter((e) => e.category === "action");
    if (aiActions.length > 0) {
      return "ai";
    }
    return "ambiguous";
  }

  // Asked a question → collaborative
  if (asked) {
    return "collaborative";
  }

  // Medium response — collaborative if AI also contributed
  if (ex.aiTurnEvents.length > 2) {
    return "collaborative";
  }

  return "ambiguous";
}

/**
 * Deterministic candidate type from exchange content heuristics.
 */
function computeCandidateType(ex: TurnExchange): string | null {
  const devText = ex.devEvent.content.detail.toLowerCase();
  const aiTexts = ex.aiTurnEvents
    .filter((e) => e.category === "proposal" || e.category === "reflection")
    .map((e) => e.content.detail.toLowerCase())
    .join(" ");

  // Rejection patterns
  if (
    /\b(no|don'?t|not|reject|wrong|instead|actually)\b/.test(devText) &&
    devText.length > 10
  ) {
    return "rejection";
  }

  // Question → could be discovery or proposal
  if (ex.devAskedQuestion && devText.length > 30) {
    return "discovery";
  }

  // Commitment patterns
  if (
    /\b(let'?s go with|we'?ll use|decided|commit|chosen|choosing)\b/i.test(
      devText,
    )
  ) {
    return "commitment";
  }

  // Pivot patterns
  if (
    /\b(actually|wait|hold on|let'?s switch|instead of|change direction)\b/i.test(
      devText,
    )
  ) {
    return "pivot";
  }

  // Confirmation patterns
  if (/\b(yes|ok|sure|looks good|that'?s right|perfect|great)\b/i.test(devText)) {
    if (devText.length < 20) return "confirmation";
  }

  // AI proposal that dev accepted passively
  if (
    ex.devResponseChars < 15 &&
    aiTexts.includes("suggest") ||
    aiTexts.includes("recommend") ||
    aiTexts.includes("propose")
  ) {
    return "proposal";
  }

  // Struggle: repeated actions on same files
  const actionFiles = ex.aiTurnEvents
    .filter((e) => e.category === "action")
    .flatMap((e) => e.content.filesAffected ?? []);
  const uniqueFiles = new Set(actionFiles);
  if (actionFiles.length > 3 && uniqueFiles.size === 1) {
    return "struggle";
  }

  return null;
}

/**
 * Topic fingerprint from file paths in the exchange.
 */
function computeTopicFingerprint(ex: TurnExchange): string {
  // Collect all file paths
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
    // Fall back to text-based topic extraction
    return extractTopicFromText(ex.devEvent.content.detail);
  }

  // Find the most common directory/file stem
  const stems = allFiles.map((f) => {
    const parts = f.split("/");
    const filename = parts[parts.length - 1];
    return filename.replace(/\.[^.]+$/, "").replace(/[._]/g, "-").toLowerCase();
  });

  // Use the most common stem
  const stemCounts = new Map<string, number>();
  for (const s of stems) {
    stemCounts.set(s, (stemCounts.get(s) ?? 0) + 1);
  }

  let bestStem = stems[0];
  let bestCount = 0;
  for (const [stem, count] of stemCounts) {
    if (count > bestCount) {
      bestStem = stem;
      bestCount = count;
    }
  }

  return bestStem;
}

function extractTopicFromText(text: string): string {
  const lower = text.toLowerCase();

  // Check for common topic keywords
  const topics = [
    "typescript",
    "database",
    "postgres",
    "storage",
    "testing",
    "eval",
    "pipeline",
    "narrative",
    "moment",
    "chunk",
    "normalize",
    "adapter",
    "architecture",
    "deployment",
    "auth",
    "api",
    "schema",
    "migration",
  ];

  for (const topic of topics) {
    if (lower.includes(topic)) return topic;
  }

  // Extract first noun-like word after common patterns
  const match = lower.match(
    /\b(?:about|for|with|the|our|my|this)\s+(\w+)/,
  );
  if (match) return match[1];

  return "general";
}

/**
 * Extract notable quotes from the exchange.
 */
function extractNotableQuotes(
  ex: TurnExchange,
): { speaker: "dev" | "ai"; text: string }[] {
  const quotes: { speaker: "dev" | "ai"; text: string }[] = [];

  // Dev quotes: look for strong language, decisions, questions
  const devText = ex.devEvent.content.detail;
  if (devText.length > 20 && devText.length < 500) {
    quotes.push({ speaker: "dev", text: devText.slice(0, 200) });
  }

  // AI quotes: look for proposals and reflections
  for (const ae of ex.aiTurnEvents) {
    if (
      (ae.category === "proposal" || ae.category === "reflection") &&
      ae.content.detail.length > 30
    ) {
      quotes.push({ speaker: "ai", text: ae.content.detail.slice(0, 200) });
      break; // One AI quote per exchange is enough
    }
  }

  return quotes;
}
