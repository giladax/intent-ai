import type { Organism } from "./chromosomes/types.js";
import type { FitnessResult } from "./fitness.js";
import { scorePipelineOutput } from "./fitness.js";
import { detectMomentsWithOrganism } from "./organism.js";
import { parseClaudeCodeLog } from "../adapters/claude-code.js";
import { normalize } from "../pipeline/normalize.js";
import { analyzeInteractions } from "../pipeline/analyze.js";
import { classifySession } from "../pipeline/classify.js";
import { chunkSession } from "../pipeline/chunk.js";
import { detectTransitionsAndOutcomes } from "../pipeline/transitions.js";
import { generateNarrative } from "../pipeline/narrative.js";
import { randomUUID } from "crypto";
import type { ScopeCriteria } from "../../tests/eval/session-criteria.js";

/**
 * Run a full pipeline with an organism's alleles swapped in for moment detection.
 *
 * Uses the EXISTING pipeline for all steps EXCEPT moment detection.
 * For moments, it uses the organism's alleles. This way we test chromosome
 * variations on one node while keeping everything else constant.
 */
export async function runOrganism(
  organism: Organism,
  fixturePath: string,
  criteria: ScopeCriteria,
): Promise<FitnessResult> {
  const sessionId = randomUUID();
  const startTime = Date.now();

  // 1. Parse (shared across all organisms)
  const rawEvents = await parseClaudeCodeLog(fixturePath);

  // 2. Normalize (shared)
  const normalizedEvents = normalize(rawEvents, sessionId);

  // 3. Analyze interactions (shared — deterministic)
  const directives = analyzeInteractions(normalizedEvents);

  // 4. Classify session shape (shared — Haiku)
  const sessionShape = await classifySession(normalizedEvents);

  // 5. Chunk (shared — deterministic)
  const chunks = chunkSession(normalizedEvents, sessionId);

  // 6. Detect moments — THIS is where the organism's alleles are used
  process.stderr.write(`  [${organism.name}] Detecting moments...\n`);
  const moments = await detectMomentsWithOrganism(
    organism,
    rawEvents,
    chunks,
    sessionShape,
    normalizedEvents,
  );
  process.stderr.write(`  [${organism.name}] Found ${moments.length} moments\n`);

  // 7. Transitions & outcomes (shared)
  const { transitions, outcomes } = await detectTransitionsAndOutcomes(
    moments,
    sessionId,
  );

  // 8. Narrative (shared)
  const narrative = await generateNarrative(
    moments,
    transitions,
    outcomes,
    sessionShape,
  );

  const elapsed = Date.now() - startTime;

  // Score
  const result = scorePipelineOutput(criteria, moments, narrative, directives);

  // Rough token/cost estimate based on organism type
  const tokenEstimate = estimateTokens(organism, chunks.length);
  const costEstimate = tokenEstimate * 0.000003; // rough Sonnet pricing per token

  return {
    chromosomeName: organism.name,
    fixture: criteria.fixture,
    ...result,
    tokensUsed: tokenEstimate,
    costEstimate,
  };
}

/**
 * Run the shared pipeline steps once and cache them for reuse across organisms.
 * This avoids redundant parsing, normalization, classification, and chunking.
 */
export async function runOrganismBatch(
  organisms: Organism[],
  fixturePath: string,
  criteria: ScopeCriteria,
): Promise<FitnessResult[]> {
  const sessionId = randomUUID();

  // Shared steps (run once)
  process.stderr.write(`Parsing fixture: ${fixturePath}\n`);
  const rawEvents = await parseClaudeCodeLog(fixturePath);
  process.stderr.write(`  ${rawEvents.length} raw events\n`);

  const normalizedEvents = normalize(rawEvents, sessionId);
  process.stderr.write(`  ${normalizedEvents.length} normalized events\n`);

  const directives = analyzeInteractions(normalizedEvents);
  process.stderr.write(`  ${directives.exchangeSummary.totalExchanges} exchanges\n`);

  process.stderr.write(`  Classifying session shape...\n`);
  const sessionShape = await classifySession(normalizedEvents);
  process.stderr.write(`  Shape: ${sessionShape}\n`);

  const chunks = chunkSession(normalizedEvents, sessionId);
  process.stderr.write(`  ${chunks.length} chunks\n\n`);

  // Per-organism: moment detection + transitions + narrative
  const results: FitnessResult[] = [];

  for (const organism of organisms) {
    process.stderr.write(`Running organism: ${organism.name}\n`);
    const startTime = Date.now();

    try {
      // Moment detection with organism alleles
      const moments = await detectMomentsWithOrganism(
        organism,
        rawEvents,
        chunks,
        sessionShape,
        normalizedEvents,
      );
      process.stderr.write(`  Found ${moments.length} moments\n`);

      // Transitions
      const { transitions, outcomes } = await detectTransitionsAndOutcomes(
        moments,
        sessionId,
      );
      process.stderr.write(
        `  ${transitions.length} transitions, ${outcomes.length} outcomes\n`,
      );

      // Narrative
      const narrative = await generateNarrative(
        moments,
        transitions,
        outcomes,
        sessionShape,
      );

      const elapsed = Date.now() - startTime;

      // Score
      const scored = scorePipelineOutput(
        criteria,
        moments,
        narrative,
        directives,
      );

      const tokenEstimate = estimateTokens(organism, chunks.length);
      const costEstimate = tokenEstimate * 0.000003;

      results.push({
        chromosomeName: organism.name,
        fixture: criteria.fixture,
        ...scored,
        tokensUsed: tokenEstimate,
        costEstimate,
      });

      process.stderr.write(
        `  Score: ${Math.round(scored.totalScore * 100)}% (${(elapsed / 1000).toFixed(1)}s)\n\n`,
      );
    } catch (err) {
      process.stderr.write(
        `  FAILED: ${err instanceof Error ? err.message : String(err)}\n\n`,
      );
      results.push({
        chromosomeName: organism.name,
        fixture: criteria.fixture,
        scores: {
          momentsDetected: 0,
          momentsCorrect: 0,
          narrativeMusts: 0,
          narrativeMustNots: 0,
          directivesCorrect: 0,
        },
        totalScore: 0,
        tokensUsed: 0,
        costEstimate: 0,
        details: {
          missingMoments: ["PIPELINE FAILED"],
          falsePositives: [],
          missingNarrativePhrases: [],
          badNarrativePhrases: [],
        },
      });
    }
  }

  return results;
}

/**
 * Rough token estimate based on organism configuration.
 */
function estimateTokens(organism: Organism, chunkCount: number): number {
  // Base: system prompt + user content per chunk
  const basePerChunk = {
    "1a_hunter": 800,
    "1b_scorer": 400,
  };
  const dataMultiplier = {
    "4a_conversation": 0.4,
    "4b_conversation_actions": 1.0,
  };
  const formatMultiplier = {
    "2b_threaded": 1.0,
    "2c_behavioral": 0.6,
  };

  const base =
    (basePerChunk[organism.instructions.name as keyof typeof basePerChunk] ?? 600) *
    chunkCount;
  const dataMul =
    dataMultiplier[organism.dataSelection.name as keyof typeof dataMultiplier] ?? 1.0;
  const fmtMul =
    formatMultiplier[organism.format.name as keyof typeof formatMultiplier] ?? 1.0;

  // Add pass2 + transitions + narrative overhead
  const overhead = 8000;

  return Math.round(base * dataMul * fmtMul + overhead);
}
