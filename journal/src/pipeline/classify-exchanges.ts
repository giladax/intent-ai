import { z } from "zod";
import { callHaiku } from "../llm/client.js";
import type { TurnExchange } from "../adapters/types.js";

// ── Exchange Classification Interface ─────────────────────────────────

export interface ExchangeClassification {
  engagement: "passive" | "active" | "challenging";
  intent: "acceptance" | "rejection" | "question" | "delegation" | "refinement" | "challenge";
  agency: "developer" | "ai" | "collaborative" | "ambiguous";
  candidateType:
    | "proposal"
    | "discovery"
    | "pivot"
    | "confirmation"
    | "rejection"
    | "commitment"
    | "struggle"
    | "breakthrough"
    | "execution"
    | null;
}

// ── Zod Schema ────────────────────────────────────────────────────────

const ClassificationSchema = z.object({
  engagement: z.enum(["passive", "active", "challenging"]),
  intent: z.enum(["acceptance", "rejection", "question", "delegation", "refinement", "challenge"]),
  agency: z.enum(["developer", "ai", "collaborative", "ambiguous"]),
  candidateType: z
    .string()
    .nullable()
    .optional()
    .default(null)
    .transform((v) => {
      const valid = ["proposal", "discovery", "pivot", "confirmation", "rejection", "commitment", "struggle", "breakthrough", "execution"];
      return v && valid.includes(v) ? v : null;
    }),
});

const BatchClassificationSchema = z.object({
  classifications: z.array(ClassificationSchema),
});

// ── Classifier Function ───────────────────────────────────────────────

/**
 * Classify all exchanges in a single Haiku call with structured output.
 *
 * Replaces regex-based classification from analyze.ts (REASONING_PATTERN,
 * MULTIPLE_OPTIONS_PATTERN) and chr3-synthesis.ts (computeAgency, computeCandidateType).
 */
export async function classifyExchanges(
  exchanges: TurnExchange[],
): Promise<ExchangeClassification[]> {
  if (exchanges.length === 0) return [];

  const systemPrompt = buildClassifierSystemPrompt();
  const userPrompt = buildClassifierUserPrompt(exchanges);

  const response = await callHaiku(systemPrompt, userPrompt, BatchClassificationSchema, {
    maxTokens: 8192,
  });

  // Pad or trim to match input length
  const results = response.classifications;
  while (results.length < exchanges.length) {
    results.push({
      engagement: "passive",
      intent: "acceptance",
      agency: "ambiguous",
      candidateType: null,
    });
  }

  return results.slice(0, exchanges.length).map((c) => ({
    engagement: c.engagement,
    intent: c.intent,
    agency: c.agency,
    candidateType: c.candidateType ?? null,
  }));
}

// ── Prompt Builders ───────────────────────────────────────────────────

function buildClassifierSystemPrompt(): string {
  return `You classify developer-AI exchanges from a coding session. For each exchange, determine 4 properties.

## Properties

1. **engagement**: How substantively did the developer respond?
   - "passive": Short response, no reasoning (e.g., "ok", "yes", "sure", "a")
   - "active": Substantive response with reasoning or detail
   - "challenging": Pushback, questions proposing alternatives, new direction, or disagreement

2. **intent**: What is the developer doing in this exchange?
   - "acceptance": Agreeing with AI's proposal or output
   - "rejection": Explicitly rejecting, correcting, or overriding AI's approach
   - "question": Asking for information or clarification
   - "delegation": Handing off a task to the AI with minimal guidance
   - "refinement": Adjusting or improving an existing approach
   - "challenge": Pushing back on assumptions or proposing alternatives

3. **agency**: Who drove this exchange?
   - "developer": Developer initiated the topic, idea, or direction
   - "ai": AI proposed and developer passively accepted
   - "collaborative": Back-and-forth where both contributed substantively
   - "ambiguous": Can't clearly determine who drove it

4. **candidateType**: If this exchange represents a meaningful moment, what type? Use null if it's routine conversation.
   - "proposal": Someone suggests an approach or architecture
   - "discovery": New information surfaces that changes understanding
   - "pivot": Direction changes from what was previously planned
   - "confirmation": A tentative approach becomes accepted
   - "rejection": An approach is explicitly rejected
   - "commitment": A firm decision that shapes subsequent work
   - "struggle": Repeated failed attempts or confusion
   - "breakthrough": A struggle resolves or confusion clears
   - "execution": Sustained implementation of a decided approach
   - null: Routine exchange, not a meaningful moment

## Rules
- Consider the CONTEXT (what the AI said/did before the developer's response) when classifying.
- A developer saying "ok" after a major architectural proposal is passive acceptance (agency: "ai"), not a commitment.
- A developer saying "actually, let's use TypeScript instead" is a rejection with developer agency.
- Short responses like "yes" or "ok" are passive engagement UNLESS they follow a significant question/decision.
- Don't over-classify: most exchanges are routine. Only mark candidateType when something meaningful happened.

Return ONLY a JSON object: { "classifications": [ { "engagement": "...", "intent": "...", "agency": "...", "candidateType": "..." | null }, ... ] }

The array MUST have exactly one entry per exchange, in order.`;
}

function buildClassifierUserPrompt(exchanges: TurnExchange[]): string {
  const exchangeList = exchanges
    .map((ex, i) => {
      const devText = truncate(ex.devEvent.content.detail, 300);

      // Get context: what the AI said/did in this exchange
      const aiTexts = ex.aiTurnEvents
        .filter((e) => e.category === "proposal" || e.category === "reflection")
        .map((e) => truncate(e.content.detail, 200))
        .slice(0, 2);

      const aiActions = ex.aiTurnEvents
        .filter((e) => e.category === "action")
        .map((e) => e.content.summary)
        .slice(0, 3);

      let context = "";
      if (aiTexts.length > 0) {
        context += `\n   AI said: ${aiTexts.join(" | ")}`;
      }
      if (aiActions.length > 0) {
        context += `\n   AI did: ${aiActions.join(", ")}`;
      }

      return `${i + 1}. DEV: "${devText}" (${ex.devResponseChars} chars)${context}`;
    })
    .join("\n\n");

  return `Classify each of the following ${exchanges.length} developer-AI exchanges:\n\n${exchangeList}`;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}
