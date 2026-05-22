/**
 * LangSmith experiment logger for chromosome learning runs.
 *
 * Wraps organism runs so each chromosome variation is logged as a
 * LangSmith experiment, viewable side-by-side in the dashboard.
 *
 * If LANGSMITH_API_KEY is not set, all functions are no-ops.
 */

import { Client } from "langsmith";
import { traceable } from "langsmith/traceable";
import type { Organism } from "./chromosomes/types.js";
import type { FitnessResult } from "./fitness.js";
import type { JudgeScore } from "./judge.js";

// ── LangSmith Client (lazy, optional) ────────────────────────────────

let _lsClient: Client | undefined;

function getLsClient(): Client | null {
  if (!process.env.LANGSMITH_API_KEY) return null;
  if (!_lsClient) {
    _lsClient = new Client();
  }
  return _lsClient;
}

// ── Experiment Logging ───────────────────────────────────────────────

export interface ExperimentEntry {
  organismName: string;
  organism: Organism;
  fixture: string;
  fitnessResult: FitnessResult;
  judgeScore: JudgeScore;
  momentsDetected: number;
  narrativeSummary?: string;
}

/**
 * Log a chromosome variation run as a LangSmith trace.
 * Uses `traceable` to create a top-level run with all the metadata
 * attached, so it shows up in the LangSmith project.
 */
export async function logExperimentRun(
  phaseName: string,
  entry: ExperimentEntry,
): Promise<void> {
  const client = getLsClient();
  if (!client) return;

  const experimentName = `${phaseName}-${entry.organismName}`;

  // Use traceable to log this as a run in LangSmith
  const logRun = traceable(
    async (_input: Record<string, unknown>) => {
      return {
        organismName: entry.organismName,
        fixture: entry.fixture,
        scores: entry.fitnessResult.scores,
        totalScore: entry.fitnessResult.totalScore,
        judgeScores: {
          momentCoverage: entry.judgeScore.momentCoverage.score,
          momentQuality: entry.judgeScore.momentQuality.score,
          narrativeAccuracy: entry.judgeScore.narrativeAccuracy.score,
          narrativeInsight: entry.judgeScore.narrativeInsight.score,
          antiPatterns: entry.judgeScore.antiPatterns.score,
          overall: entry.judgeScore.overall,
        },
        momentsDetected: entry.momentsDetected,
        narrativeSummary: entry.narrativeSummary ?? "",
        details: entry.fitnessResult.details,
        tokensUsed: entry.fitnessResult.tokensUsed,
        costEstimate: entry.fitnessResult.costEstimate,
      };
    },
    {
      name: experimentName,
      run_type: "chain",
      metadata: {
        phase: phaseName,
        organism: entry.organismName,
        fixture: entry.fixture,
        instructions: entry.organism.instructions.name,
        format: entry.organism.format.name,
        synthesis: entry.organism.synthesis.name,
        dataSelection: entry.organism.dataSelection.name,
      },
      tags: ["chromosome-learning", phaseName, entry.organismName],
    },
  );

  await logRun({
    organism: {
      name: entry.organismName,
      instructions: entry.organism.instructions.name,
      format: entry.organism.format.name,
      synthesis: entry.organism.synthesis.name,
      dataSelection: entry.organism.dataSelection.name,
    },
    fixture: entry.fixture,
  });
}

/**
 * Log a complete phase outcome (all organisms + winner).
 */
export async function logPhaseOutcome(
  phaseName: string,
  entries: ExperimentEntry[],
  winnerName: string,
): Promise<void> {
  const client = getLsClient();
  if (!client) return;

  // Log each individual run
  for (const entry of entries) {
    await logExperimentRun(phaseName, entry);
  }

  // Log the phase summary
  const logSummary = traceable(
    async (_input: Record<string, unknown>) => {
      return {
        phase: phaseName,
        winner: winnerName,
        results: entries.map((e) => ({
          name: e.organismName,
          judgeOverall: e.judgeScore.overall,
          totalScore: e.fitnessResult.totalScore,
        })),
      };
    },
    {
      name: `${phaseName}-summary`,
      run_type: "chain",
      metadata: { phase: phaseName, winner: winnerName },
      tags: ["chromosome-learning", "phase-summary", phaseName],
    },
  );

  await logSummary({
    phase: phaseName,
    organismCount: entries.length,
    winner: winnerName,
  });
}
