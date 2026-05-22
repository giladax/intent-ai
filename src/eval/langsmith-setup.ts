/**
 * Upload eval fixtures as LangSmith datasets.
 *
 * Each fixture + its ScopeCriteria becomes one dataset example so we can
 * run experiments against them in the LangSmith dashboard.
 *
 * Usage:
 *   npx tsx src/eval/langsmith-setup.ts
 */

import "dotenv/config";
import { Client } from "langsmith";
import {
  allScopes,
  type ScopeCriteria,
} from "../../tests/eval/session-criteria.js";

const DATASET_NAME = "intent-ai-eval-fixtures";

export async function uploadFixturesAsDataset(): Promise<void> {
  const apiKey = process.env.LANGSMITH_API_KEY;
  if (!apiKey) {
    console.log("LANGSMITH_API_KEY not set — skipping dataset upload.");
    return;
  }

  const client = new Client();

  // Delete existing dataset if it exists (idempotent re-upload)
  try {
    const existing = await client.readDataset({ datasetName: DATASET_NAME });
    if (existing) {
      await client.deleteDataset({ datasetName: DATASET_NAME });
      console.log(`Deleted existing dataset "${DATASET_NAME}".`);
    }
  } catch {
    // Dataset doesn't exist yet — fine
  }

  // Create fresh dataset
  const dataset = await client.createDataset(DATASET_NAME, {
    description:
      "Eval fixtures for intent-ai moment detection and narrative pipeline. Each example represents a session scope with ground truth criteria.",
  });
  console.log(`Created dataset "${DATASET_NAME}" (id: ${dataset.id})`);

  // Add each scope as an example
  const inputs: Record<string, unknown>[] = [];
  const outputs: Record<string, unknown>[] = [];

  for (const scope of allScopes) {
    inputs.push({
      name: scope.name,
      fixture: scope.fixture,
      groundTruth: scope.groundTruth ?? "",
      expectedShape: scope.expectedShape,
    });

    outputs.push({
      mustDetectMoments: scope.mustDetectMoments,
      mustNotDetect: scope.mustNotDetect,
      expectedTransitions: scope.expectedTransitions,
      narrativeMusts: scope.narrativeMusts,
      narrativeMustNots: scope.narrativeMustNots,
      expectedDirectives: scope.expectedDirectives,
    });
  }

  await client.createExamples({
    inputs,
    outputs,
    datasetName: DATASET_NAME,
  });

  console.log(`Uploaded ${allScopes.length} examples to "${DATASET_NAME}".`);
}

// ── CLI Entry Point ──────────────────────────────────────────────────

const isMainModule =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("langsmith-setup.ts");

if (isMainModule) {
  uploadFixturesAsDataset().catch((err) => {
    console.error("Failed to upload dataset:", err);
    process.exit(1);
  });
}
