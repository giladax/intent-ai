import "dotenv/config";
import { designScope } from "./tests/eval/session-criteria.js";
import { runOrganismBatch } from "./src/eval/runner.js";
import { judgeOutput } from "./src/eval/judge.js";
import { logPhaseOutcome, type ExperimentEntry } from "./src/eval/langsmith-experiment.js";
import type { Organism } from "./src/eval/chromosomes/types.js";
import type { FitnessResult } from "./src/eval/fitness.js";
import type { JudgeScore } from "./src/eval/judge.js";

// ── Chr 1: Instructions ─────────────────────────────────────────────
import { hunter, scorer } from "./src/eval/chromosomes/chr1-instructions.js";

// ── Chr 2: Formats ──────────────────────────────────────────────────
import { flat, threaded, behavioral, prelabeled } from "./src/eval/chromosomes/chr2-formats.js";

// ── Chr 3: Synthesis ────────────────────────────────────────────────
import {
  noSynthesis,
  exchangePairs,
  fullPrecompute,
  haikuClassified,
} from "./src/eval/chromosomes/chr3-synthesis.js";

// ── Chr 4: Data Selection ───────────────────────────────────────────
import {
  conversationOnly,
  conversationActions,
  conversationActionsResults,
  conversationDiffs,
} from "./src/eval/chromosomes/chr4-data.js";

// ── Types ───────────────────────────────────────────────────────────

interface PhaseResult {
  alleleName: string;
  score: JudgeScore;
  fitnessResult: FitnessResult;
}

interface PhaseOutcome {
  phaseName: string;
  results: PhaseResult[];
  winnerName: string;
  winnerScore: number;
}

const FIXTURE_PATH = "tests/eval/fixtures/scope-design.jsonl";

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Learning Strategy: One Chromosome at a Time");
  console.log("  Fixture: design-scope (cheapest)");
  console.log("  Budget: ~$1.00 for full run");
  console.log("═══════════════════════════════════════════════════════════\n");

  const outcomes: PhaseOutcome[] = [];

  // ── Phase 1: Find best Chr 4 (Data Selection) ──────────────────────
  const phase1 = await runPhase({
    phaseName: "Phase 1: Data Selection (Chr 4)",
    holdDescription: "{1a_hunter, 2b_threaded, 3b_exchanges}",
    organisms: [
      { name: "4a_conversation", instructions: hunter, format: threaded, synthesis: exchangePairs, dataSelection: conversationOnly },
      { name: "4b_conversation_actions", instructions: hunter, format: threaded, synthesis: exchangePairs, dataSelection: conversationActions },
      { name: "4c_conv_actions_results", instructions: hunter, format: threaded, synthesis: exchangePairs, dataSelection: conversationActionsResults },
      { name: "4d_conversation_diffs", instructions: hunter, format: threaded, synthesis: exchangePairs, dataSelection: conversationDiffs },
    ],
  });
  outcomes.push(phase1);
  const bestData = getBestDataAllele(phase1.winnerName);

  // ── Phase 2: Find best Chr 3 (Synthesis) ───────────────────────────
  const phase2 = await runPhase({
    phaseName: "Phase 2: Synthesis (Chr 3)",
    holdDescription: `{1a_hunter, 2b_threaded, ${phase1.winnerName}}`,
    organisms: [
      { name: "3a_none", instructions: hunter, format: threaded, synthesis: noSynthesis, dataSelection: bestData },
      { name: "3b_exchange_pairs", instructions: hunter, format: threaded, synthesis: exchangePairs, dataSelection: bestData },
      { name: "3c_full_precompute", instructions: hunter, format: threaded, synthesis: fullPrecompute, dataSelection: bestData },
      { name: "3e_haiku_classified", instructions: hunter, format: threaded, synthesis: haikuClassified, dataSelection: bestData },
    ],
  });
  outcomes.push(phase2);
  const bestSynthesis = getBestSynthesisAllele(phase2.winnerName);

  // ── Phase 3: Find best Chr 2 (Format) ─────────────────────────────
  const phase3 = await runPhase({
    phaseName: "Phase 3: Format (Chr 2)",
    holdDescription: `{1a_hunter, ${phase2.winnerName}, ${phase1.winnerName}}`,
    organisms: [
      { name: "2a_flat", instructions: hunter, format: flat, synthesis: bestSynthesis, dataSelection: bestData },
      { name: "2b_threaded", instructions: hunter, format: threaded, synthesis: bestSynthesis, dataSelection: bestData },
      { name: "2c_behavioral", instructions: hunter, format: behavioral, synthesis: bestSynthesis, dataSelection: bestData },
      { name: "2e_prelabeled", instructions: hunter, format: prelabeled, synthesis: bestSynthesis, dataSelection: bestData },
    ],
  });
  outcomes.push(phase3);
  const bestFormat = getBestFormatAllele(phase3.winnerName);

  // ── Phase 4: Find best Chr 1 (Instructions) ───────────────────────
  const phase4 = await runPhase({
    phaseName: "Phase 4: Instructions (Chr 1)",
    holdDescription: `{${phase3.winnerName}, ${phase2.winnerName}, ${phase1.winnerName}}`,
    organisms: [
      { name: "1a_hunter", instructions: hunter, format: bestFormat, synthesis: bestSynthesis, dataSelection: bestData },
      { name: "1b_scorer", instructions: scorer, format: bestFormat, synthesis: bestSynthesis, dataSelection: bestData },
    ],
  });
  outcomes.push(phase4);

  // ── Final Report ──────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  FINAL RESULTS");
  console.log("═══════════════════════════════════════════════════════════\n");

  for (const outcome of outcomes) {
    console.log(`  ${outcome.phaseName}: ${outcome.winnerName} (${outcome.winnerScore.toFixed(1)}/5)`);
  }

  console.log(`\n  Winner organism: {${phase4.winnerName}, ${phase3.winnerName}, ${phase2.winnerName}, ${phase1.winnerName}}`);
  console.log(`  Overall score: ${phase4.results.find((r) => r.alleleName === phase4.winnerName)?.score.overall.toFixed(2)}/5\n`);
}

// ── Phase Runner ────────────────────────────────────────────────────

async function runPhase(config: {
  phaseName: string;
  holdDescription: string;
  organisms: Organism[];
}): Promise<PhaseOutcome> {
  console.log(`\n═══ ${config.phaseName} ${"═".repeat(Math.max(0, 50 - config.phaseName.length))}`);
  console.log(`Hold: ${config.holdDescription}\n`);

  // Run all organisms through the pipeline
  const fitnessResults = await runOrganismBatch(
    config.organisms,
    FIXTURE_PATH,
    designScope,
  );

  // Judge each result
  const phaseResults: PhaseResult[] = [];

  for (let i = 0; i < config.organisms.length; i++) {
    const organism = config.organisms[i];
    const fitness = fitnessResults[i];

    process.stderr.write(`  Judging ${organism.name}...\n`);

    // We need to re-run the pipeline to get moments and narrative for judging
    // The fitness result doesn't expose these directly, so we use the runner
    // which already ran the pipeline. For now, create a minimal judge call
    // using the fitness details as a proxy.
    //
    // In practice, we'd modify runOrganismBatch to return moments+narrative.
    // For this initial implementation, we judge based on the fitness output
    // by running the pipeline again for the winner only (cost-conscious approach).
    //
    // However, since the runner already ran the full pipeline, we'll construct
    // a lightweight judge call with the information we have.

    try {
      // Run standalone for judging — the runner already did the heavy lifting
      // We need to run again to get moments/narrative for the judge
      const { runOrganism } = await import("./src/eval/runner.js");
      const fullResult = await runOrganismForJudging(organism);
      phaseResults.push({
        alleleName: organism.name,
        score: fullResult.judgeScore,
        fitnessResult: fitness,
      });

      const s = fullResult.judgeScore;
      console.log(`  ${organism.name.padEnd(30)} ${s.overall.toFixed(1)}/5  "${s.momentCoverage.reasoning.slice(0, 60)}..."`);
    } catch (err) {
      // If judging fails, use a zero score
      const zeroScore: JudgeScore = {
        momentCoverage: { score: 1, reasoning: "Judge failed", found: [], missed: [] },
        momentQuality: { score: 1, reasoning: "Judge failed" },
        narrativeAccuracy: { score: 1, reasoning: "Judge failed" },
        narrativeInsight: { score: 1, reasoning: "Judge failed" },
        antiPatterns: { score: 1, reasoning: "Judge failed" },
        overall: 1,
      };
      phaseResults.push({ alleleName: organism.name, score: zeroScore, fitnessResult: fitness });
      console.log(`  ${organism.name.padEnd(30)} FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Find winner
  let winnerIdx = 0;
  for (let i = 1; i < phaseResults.length; i++) {
    if (phaseResults[i].score.overall > phaseResults[winnerIdx].score.overall) {
      winnerIdx = i;
    }
  }

  const winner = phaseResults[winnerIdx];
  console.log(`\n  Winner: ${winner.alleleName} — ${winner.score.overall.toFixed(1)}/5`);

  // Log to LangSmith (no-op if env vars not set)
  try {
    const experimentEntries: ExperimentEntry[] = phaseResults.map((r, i) => ({
      organismName: r.alleleName,
      organism: config.organisms[i],
      fixture: designScope.fixture,
      fitnessResult: r.fitnessResult,
      judgeScore: r.score,
      momentsDetected: r.fitnessResult.scores.momentsDetected,
    }));
    await logPhaseOutcome(config.phaseName, experimentEntries, winner.alleleName);
  } catch (err) {
    process.stderr.write(`  LangSmith logging failed (non-fatal): ${err instanceof Error ? err.message : String(err)}\n`);
  }

  return {
    phaseName: config.phaseName,
    results: phaseResults,
    winnerName: winner.alleleName,
    winnerScore: winner.score.overall,
  };
}

// ── Run Organism for Judging ────────────────────────────────────────
// Runs the full pipeline and then judges the output

async function runOrganismForJudging(
  organism: Organism,
): Promise<{ judgeScore: JudgeScore }> {
  const { randomUUID } = await import("crypto");
  const { parseClaudeCodeLog } = await import("./src/adapters/claude-code.js");
  const { normalize } = await import("./src/pipeline/normalize.js");
  const { analyzeInteractions } = await import("./src/pipeline/analyze.js");
  const { classifySession } = await import("./src/pipeline/classify.js");
  const { chunkSession } = await import("./src/pipeline/chunk.js");
  const { detectMomentsWithOrganism } = await import("./src/eval/organism.js");
  const { detectTransitionsAndOutcomes } = await import("./src/pipeline/transitions.js");
  const { generateNarrative } = await import("./src/pipeline/narrative.js");

  const sessionId = randomUUID();
  const rawEvents = await parseClaudeCodeLog(FIXTURE_PATH);
  const normalizedEvents = normalize(rawEvents, sessionId);
  const sessionShape = await classifySession(normalizedEvents);
  const chunks = chunkSession(normalizedEvents, sessionId);

  const moments = await detectMomentsWithOrganism(
    organism,
    rawEvents,
    chunks,
    sessionShape,
    normalizedEvents,
  );

  const { transitions, outcomes } = await detectTransitionsAndOutcomes(moments, sessionId);
  const narrative = await generateNarrative(moments, transitions, outcomes, sessionShape);

  const judgeScore = await judgeOutput(designScope, moments, narrative);
  return { judgeScore };
}

// ── Allele Lookup Helpers ───────────────────────────────────────────

function getBestDataAllele(name: string) {
  const map: Record<string, typeof conversationOnly> = {
    "4a_conversation": conversationOnly,
    "4b_conversation_actions": conversationActions,
    "4c_conv_actions_results": conversationActionsResults,
    "4d_conversation_diffs": conversationDiffs,
  };
  return map[name] ?? conversationActions;
}

function getBestSynthesisAllele(name: string) {
  const map: Record<string, typeof exchangePairs> = {
    "3a_none": noSynthesis,
    "3b_exchange_pairs": exchangePairs,
    "3c_full_precompute": fullPrecompute,
    "3e_haiku_classified": haikuClassified,
  };
  return map[name] ?? exchangePairs;
}

function getBestFormatAllele(name: string) {
  const map: Record<string, typeof threaded> = {
    "2a_flat": flat,
    "2b_threaded": threaded,
    "2c_behavioral": behavioral,
    "2e_prelabeled": prelabeled,
  };
  return map[name] ?? threaded;
}

// ── Entry Point ─────────────────────────────────────────────────────

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
