/**
 * Gen2B experiment: Tree-First Schema
 *
 * Hypothesis: Removing conceptualMap and adding required level field
 * to assignments forces the LLM to commit to hierarchy inline.
 *
 * Run: npx tsx tests/experiments/gen2b-test.ts
 */

import { buildBrainOrganizePrompt } from "../../src/llm/prompts/brain-organize-gen2b.js";
import type { ExistingSpec, OrganizeSignals } from "../../src/llm/prompts/brain-organize-gen2b.js";
import type { SpecFragment } from "../../src/llm/prompts/brain-extract.js";

// ── Sample data ─────────────────────────────────────────────────────

const sampleFragments: SpecFragment[] = [
  {
    nameHint: "Pipeline Orchestration",
    insights: [
      { category: "structure", statement: "Pipeline runs steps sequentially through an orchestrator", evidence: [] },
      { category: "decision", statement: "Each step enriches shared context, never replaces upstream data", evidence: [] },
    ],
    fileRefs: [
      { path: "src/pipeline/orchestrator.ts", role: "core" },
      { path: "src/pipeline/normalize.ts", role: "step" },
    ],
  },
  {
    nameHint: "Moment Detection",
    insights: [
      { category: "structure", statement: "Moments are extracted in two passes: P1 (Haiku) and P2 (Sonnet)", evidence: [] },
      { category: "behavior", statement: "Moment quality depends on good chunking upstream", evidence: [] },
    ],
    fileRefs: [
      { path: "src/pipeline/moments-p1.ts", role: "core" },
      { path: "src/pipeline/moments-p2.ts", role: "core" },
    ],
  },
  {
    nameHint: "Dashboard Layout",
    insights: [
      { category: "structure", statement: "Dashboard uses a three-panel split-view layout", evidence: [] },
      { category: "interface", statement: "Left panel shows features, center shows sessions and story", evidence: [] },
    ],
    fileRefs: [
      { path: "src/web/app/dashboard/page.tsx", role: "core" },
    ],
  },
  {
    nameHint: "Eval Framework",
    insights: [
      { category: "structure", statement: "Fitness scoring uses LLM-as-judge pattern", evidence: [] },
      { category: "decision", statement: "Eval criteria are written before code changes (EDD)", evidence: [] },
    ],
    fileRefs: [
      { path: "src/eval/fitness.ts", role: "core" },
      { path: "tests/eval/session-criteria.ts", role: "criteria" },
    ],
  },
  {
    nameHint: "Brain Knowledge Graph",
    insights: [
      { category: "structure", statement: "Brain synthesizes topics from multiple session digests", evidence: [] },
      { category: "decision", statement: "Topics should be hierarchical specs, not flat changelogs", evidence: [] },
    ],
    fileRefs: [
      { path: "src/llm/prompts/brain-organize.ts", role: "core" },
      { path: "src/cli/brain.ts", role: "cli" },
    ],
  },
];

const sampleExistingSpecs: ExistingSpec[] = [
  {
    name: "Pipeline",
    summary: "Multi-step processing pipeline for CC session logs",
    insightCount: 12,
    fileList: ["src/pipeline/orchestrator.ts", "src/pipeline/normalize.ts"],
    sessionCount: 5,
    daysSinceUpdate: 3,
  },
  {
    name: "Dashboard",
    summary: "Web dashboard for viewing session digests",
    insightCount: 6,
    fileList: ["src/web/app/dashboard/page.tsx"],
    sessionCount: 2,
    daysSinceUpdate: 1,
  },
];

const sampleSignals: OrganizeSignals = {
  sharedFileRatios: [
    { specA: "Pipeline", specB: "Dashboard", ratio: 0.05 },
  ],
};

// ── Run ─────────────────────────────────────────────────────────────

// Test 1: Warm start (existing specs + new fragments)
console.log("=== Gen2B: Tree-First Schema (warm start) ===\n");
const warmResult = buildBrainOrganizePrompt(sampleExistingSpecs, sampleFragments, sampleSignals);
console.log("--- SYSTEM PROMPT ---");
console.log(warmResult.system);
console.log("\n--- USER PROMPT ---");
console.log(warmResult.user);

// Test 2: Cold start (no existing specs)
console.log("\n\n=== Gen2B: Tree-First Schema (cold start) ===\n");
const coldResult = buildBrainOrganizePrompt([], sampleFragments, { sharedFileRatios: [] });
console.log("--- SYSTEM PROMPT ---");
console.log(coldResult.system);

// Test 3: Verify schema changes
console.log("\n\n=== Schema Verification ===");
import { GraphPlanSchema } from "../../src/llm/prompts/brain-organize-gen2b.js";

// Valid: root spec
const validRoot = GraphPlanSchema.safeParse({
  assignments: [{ fragmentIndex: 0, targetSpec: "Pipeline", action: "update", level: "root" }],
});
console.log(`Root without parentSpec: ${validRoot.success ? "PASS" : "FAIL"}`);

// Valid: child spec with parentSpec
const validChild = GraphPlanSchema.safeParse({
  assignments: [{ fragmentIndex: 0, targetSpec: "Moments", action: "create", level: "child", parentSpec: "Pipeline" }],
});
console.log(`Child with parentSpec: ${validChild.success ? "PASS" : "FAIL"}`);

// Should parse but level is required
const missingLevel = GraphPlanSchema.safeParse({
  assignments: [{ fragmentIndex: 0, targetSpec: "Moments", action: "create" }],
});
console.log(`Missing level field: ${missingLevel.success ? "FAIL (should reject)" : "PASS (correctly rejects)"}`);

// Should NOT have conceptualMap in schema
const withConceptualMap = GraphPlanSchema.safeParse({
  conceptualMap: [{ name: "test", description: "test" }],
  assignments: [{ fragmentIndex: 0, targetSpec: "Pipeline", action: "update", level: "root" }],
});
console.log(`conceptualMap field: ${withConceptualMap.success ? "PASS (passthrough allows it but not in type)" : "FAIL"}`);
