import type {
  Organism,
  NodeContext,
  SynthesizedData,
  EnrichedExchange,
} from "./chromosomes/types.js";
import type {
  RawDevEvent,
  NormalizedDevEvent,
  SessionChunk,
  SessionMoment,
  PipelineDirectives,
} from "../adapters/types.js";
import { normalize } from "../pipeline/normalize.js";
import { callSonnet } from "../llm/client.js";
import {
  Pass1OutputSchema,
  buildPass2Prompt,
  Pass2OutputSchema,
  type Pass1Moment,
} from "../llm/prompts/moments.js";
import type { SessionShape as PromptSessionShape } from "../llm/prompts/classify.js";

/**
 * Run a single chunk through an organism's alleles and return Pass1 moments.
 *
 * Steps:
 * 1. Build the system prompt from Chr 1 (Instructions)
 * 2. Format the chunk content using Chr 2 (Format)
 * 3. Call the LLM
 * 4. Parse and return moments
 */
export async function processChunkWithOrganism(
  organism: Organism,
  chunk: SessionChunk,
  synthesized: SynthesizedData,
  context: NodeContext,
): Promise<Pass1Moment[]> {
  // Chr 1: Build system prompt
  const systemPrompt = organism.instructions.buildSystemPrompt(context);

  // Chr 2: Format the chunk events
  // Use enriched exchanges if available (Chr 3c+), otherwise use basic exchanges
  const userContent = buildUserContent(organism, chunk, synthesized);

  // Call the LLM
  const result = await callSonnet(systemPrompt, userContent, Pass1OutputSchema);
  return result.moments;
}

/**
 * Build the user content for the LLM call using the organism's format allele.
 */
function buildUserContent(
  organism: Organism,
  chunk: SessionChunk,
  synthesized: SynthesizedData,
): string {
  // Filter exchanges to those relevant to this chunk
  const chunkEventIds = new Set(chunk.events.map((e) => e.id));

  const relevantExchanges = synthesized.exchanges.filter((ex) =>
    chunkEventIds.has(ex.devEvent.id),
  );

  // Use the format allele to render
  const formatted = organism.format.render(
    relevantExchanges,
    chunk.events,
    synthesized.directives,
  );

  // If we have enriched exchanges (Chr 3c+) and format supports it, add pre-computed labels
  let preComputedSection = "";
  if (synthesized.enrichedExchanges) {
    const relevantEnriched = synthesized.enrichedExchanges.filter((ee) =>
      chunkEventIds.has(ee.devEvent.id),
    );
    if (relevantEnriched.length > 0) {
      preComputedSection = formatEnrichedExchanges(relevantEnriched);
    }
  }

  return `## Chunk ${chunk.chunkIndex} — Topic: ${chunk.topicHint}
## Files in scope: ${chunk.filesInScope.slice(0, 15).join(", ")}

## Events (${chunk.events.length} total):

${formatted}${preComputedSection}

Extract the meaningful moments from this chunk. Return JSON only.`;
}

/**
 * Format enriched exchanges for organisms that use pre-computed labels.
 */
function formatEnrichedExchanges(enriched: EnrichedExchange[]): string {
  const lines = enriched.map((ee, i) => {
    const quotes = ee.notableQuotes
      .map((q) => `  ${q.speaker}: "${q.text.slice(0, 100)}"`)
      .join("\n");
    return `Exchange ${i}:
  agency: ${ee.agency}
  candidateType: ${ee.candidateType ?? "none"}
  topic: ${ee.topicFingerprint}
  quotes:
${quotes}`;
  });

  return `\n\n## Pre-computed Labels\n\n${lines.join("\n\n")}`;
}

/**
 * Detect moments using an organism's alleles on pre-chunked, pre-classified data.
 *
 * This replaces the standard detectMoments() call but uses the organism's
 * alleles for the moment detection node while keeping everything else constant.
 */
export async function detectMomentsWithOrganism(
  organism: Organism,
  rawEvents: RawDevEvent[],
  chunks: SessionChunk[],
  sessionShape: string,
  normalizedEvents: NormalizedDevEvent[],
): Promise<SessionMoment[]> {
  // Chr 4: Data Selection — filter raw events
  const selectedEvents = organism.dataSelection.select(rawEvents);

  // Normalize the selected events
  const sessionId = normalizedEvents[0]?.sessionId ?? "eval";
  const selectedNormalized = normalize(selectedEvents, sessionId);

  // Chr 3: Synthesis — pre-compute
  const synthesized = organism.synthesis.process(
    selectedNormalized.length > 0 ? selectedNormalized : normalizedEvents,
  );

  // Process each chunk with the organism (Pass 1)
  const pass1Results = await Promise.all(
    chunks.map(async (chunk) => {
      const context: NodeContext = {
        sessionShape,
        chunkIndex: chunk.chunkIndex,
        totalChunks: chunks.length,
        directives: synthesized.directives,
      };

      const moments = await processChunkWithOrganism(
        organism,
        chunk,
        synthesized,
        context,
      );

      return { chunkIndex: chunk.chunkIndex, moments };
    }),
  );

  // Pass 2: cross-chunk merge (same as standard pipeline)
  const shapeObj: PromptSessionShape = { shape: sessionShape as PromptSessionShape["shape"] };
  const { system, user } = buildPass2Prompt({
    pass1Moments: pass1Results,
    sessionShape: shapeObj,
    totalChunks: chunks.length,
  });
  const pass2Result = await callSonnet(system, user, Pass2OutputSchema);

  // Convert to SessionMoment[]
  return pass2Result.moments.map((m, i) => ({
    id: `moment-${i}`,
    chunkId: chunks[0]?.id ?? "unknown",
    type: m.type,
    statement: m.statement,
    significance: m.significance,
    agency: m.agency === "collaborative" ? "collaborative" : m.agency,
    confidence: m.confidence,
    topicFingerprint: m.topicFingerprint,
    relatedMomentIds: m.relatedMomentIds.map((id) => `moment-${id}`),
    arcId: m.arcId,
    arcRole: mapArcRole(m.arcRole),
    evidence: m.evidence.map((e) => ({
      quote: e.quote,
      sourceEventId: ("sourceEventId" in e ? (e as { sourceEventId?: string }).sourceEventId : undefined) ?? "",
      sourceType: mapSourceType(e.sourceType),
      quoteType: e.quoteType === "verbatim" ? "verbatim" as const : "summarized" as const,
    })),
  }));
}

function mapArcRole(
  role: string,
): "origin" | "escalation" | "turning_point" | "resolution" {
  switch (role) {
    case "origin":
      return "origin";
    case "turning_point":
      return "turning_point";
    case "resolution":
      return "resolution";
    default:
      return "escalation";
  }
}

function mapSourceType(
  st: string,
): "human_message" | "ai_message" | "tool_output" | "tool_input" {
  switch (st) {
    case "user":
      return "human_message";
    case "ai":
      return "ai_message";
    case "tool_output":
      return "tool_output";
    default:
      return "tool_input";
  }
}
