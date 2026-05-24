/**
 * Gen2C Experiment — Few-Shot Example for brain-organize
 *
 * Hypothesis: Adding a concrete few-shot example showing a well-structured
 * tree with parentSpec correctly set will improve hierarchical output.
 *
 * Run: npx tsx tests/experiments/gen2c-test.ts
 */

import { buildBrainOrganizePrompt } from "../../src/llm/prompts/brain-organize-gen2c.js";
import type { ExistingSpec, OrganizeSignals } from "../../src/llm/prompts/brain-organize-gen2c.js";
import type { SpecFragment } from "../../src/llm/prompts/brain-extract.js";

// ── Fake data to exercise the prompt ────────────────────────────────

const existingSpecs: ExistingSpec[] = [];

const fragments: SpecFragment[] = [
  {
    nameHint: "Pipeline orchestration",
    insights: [
      { category: "structure", statement: "Orchestrator chains parse → normalize → classify → chunk → analyze steps", evidence: [{ reasoning: "implicit" }], confidence: 90 },
      { category: "decision", statement: "Each step enriches shared context, never replaces upstream data", evidence: [{ reasoning: "implicit" }], confidence: 85 },
    ],
    fileRefs: [
      { path: "src/pipeline/orchestrator.ts", role: "main" },
      { path: "src/pipeline/normalize.ts", role: "step" },
    ],
  },
  {
    nameHint: "LLM client",
    insights: [
      { category: "structure", statement: "Anthropic SDK wrapper with streaming, retries, Zod validation", evidence: [{ reasoning: "implicit" }], confidence: 90 },
    ],
    fileRefs: [
      { path: "src/llm/client.ts", role: "main" },
    ],
  },
  {
    nameHint: "Dashboard UI",
    insights: [
      { category: "structure", statement: "Three-panel layout: features list, session story, chat", evidence: [{ reasoning: "implicit" }], confidence: 85 },
      { category: "behavior", statement: "Breadcrumb navigation for drilling into sessions", evidence: [{ reasoning: "implicit" }], confidence: 80 },
    ],
    fileRefs: [
      { path: "src/web/app/page.tsx", role: "main" },
    ],
  },
  {
    nameHint: "Eval framework",
    insights: [
      { category: "structure", statement: "Fitness scoring with LLM-as-judge for narrative quality", evidence: [{ reasoning: "implicit" }], confidence: 90 },
    ],
    fileRefs: [
      { path: "src/eval/fitness.ts", role: "main" },
    ],
  },
] as unknown as SpecFragment[];

const signals: OrganizeSignals = {
  sharedFileRatios: [],
};

// ── Generate and print ──────────────────────────────────────────────

const { system, user } = buildBrainOrganizePrompt(existingSpecs, fragments, signals);

console.log("=".repeat(80));
console.log("SYSTEM PROMPT");
console.log("=".repeat(80));
console.log(system);
console.log("\n" + "=".repeat(80));
console.log("USER PROMPT");
console.log("=".repeat(80));
console.log(user);
console.log("\n" + "=".repeat(80));
console.log(`System prompt length: ${system.length} chars`);
console.log(`User prompt length: ${user.length} chars`);
console.log(`Total: ${system.length + user.length} chars`);
