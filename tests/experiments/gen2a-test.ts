/**
 * Gen2A experiment: Two-pass output (force hierarchy first, then assign)
 *
 * This script builds the prompt with sample data and prints it for inspection.
 * Does NOT call any LLM.
 *
 * Usage: npx tsx tests/experiments/gen2a-test.ts
 */

import { buildBrainOrganizePrompt } from "../../src/llm/prompts/brain-organize-gen2a.js";
import type { SpecFragment } from "../../src/llm/prompts/brain-extract.js";
import type { ExistingSpec, OrganizeSignals } from "../../src/llm/prompts/brain-organize-gen2a.js";

// ── Sample fragments: 3 aspects of a pipeline project ──────────────

const fragments: SpecFragment[] = [
  {
    nameHint: "Pipeline Orchestration",
    insights: [
      {
        category: "structure",
        statement: "Pipeline runs 7 steps sequentially: parse, normalize, classify, chunk, analyze, moments, narrative",
        evidence: [{ momentId: "m-001", reasoning: "Orchestrator wiring" }],
        confidence: 90,
      },
      {
        category: "decision",
        statement: "Each step enriches shared context rather than replacing upstream data",
        evidence: [{ momentId: "m-002", reasoning: "Design principle discussion" }],
        confidence: 85,
      },
    ],
    fileRefs: [
      { path: "src/pipeline/orchestrator.ts", role: "main pipeline runner" },
    ],
  },
  {
    nameHint: "LLM Integration",
    insights: [
      {
        category: "structure",
        statement: "Anthropic SDK wrapper handles streaming, retries, and Zod validation",
        evidence: [{ momentId: "m-003", reasoning: "Client implementation" }],
        confidence: 90,
      },
      {
        category: "constraint",
        statement: "Sonnet for reasoning tasks, Haiku for classification and routing",
        evidence: [{ momentId: "m-004", reasoning: "Model selection rationale" }],
        confidence: 95,
      },
    ],
    fileRefs: [
      { path: "src/llm/client.ts", role: "Anthropic SDK wrapper" },
      { path: "src/llm/prompts/", role: "prompt builders" },
    ],
  },
  {
    nameHint: "Storage Layer",
    insights: [
      {
        category: "decision",
        statement: "PostgreSQL chosen over SQLite for pgvector support and concurrent access",
        evidence: [{ momentId: "m-005", reasoning: "Database selection" }],
        confidence: 90,
      },
      {
        category: "structure",
        statement: "Drizzle ORM used for type-safe schema definitions and migrations",
        evidence: [{ momentId: "m-006", reasoning: "ORM choice" }],
        confidence: 85,
      },
      {
        category: "behavior",
        statement: "Database runs on port 5433 via Docker Compose to avoid conflicts with local Postgres",
        evidence: [{ momentId: "m-007", reasoning: "Port config" }],
        confidence: 95,
      },
    ],
    fileRefs: [
      { path: "src/storage/schema.ts", role: "Drizzle schema definitions" },
      { path: "drizzle/", role: "migration files" },
    ],
  },
];

const existingSpecs: ExistingSpec[] = [];
const signals: OrganizeSignals = { sharedFileRatios: [] };

// ── Build and print ─────────────────────────────────────────────────

const { system, user } = buildBrainOrganizePrompt(existingSpecs, fragments, signals);

console.log("=".repeat(80));
console.log("SYSTEM PROMPT");
console.log("=".repeat(80));
console.log(system);
console.log();
console.log("=".repeat(80));
console.log("USER PROMPT");
console.log("=".repeat(80));
console.log(user);
