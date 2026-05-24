import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { callHaiku } from "../llm/client.js";
import { generateAllMarkdown } from "../brain/generate-markdown.js";

// ── Verdict Enums ─────────────────────────────────────────────────────

const SpecQualityVerdict = z.enum(["design_doc", "mixed", "changelog"]);
const HierarchyVerdict = z.enum(["navigable", "shallow", "flat"]);
const DeduplicationVerdict = z.enum(["clean", "some_overlap", "redundant"]);
const ScopePrecisionVerdict = z.enum(["focused", "broad", "tangled"]);
const ActionabilityVerdict = z.enum(["actionable", "vague", "useless"]);

// ── Dimension Schemas ─────────────────────────────────────────────────

const SpecQualityDimension = z
  .object({
    verdict: SpecQualityVerdict,
    reasoning: z.string(),
    examples: z.array(z.string()).optional().default([]),
  })
  .passthrough();

const HierarchyDimension = z
  .object({
    verdict: HierarchyVerdict,
    reasoning: z.string(),
    examples: z.array(z.string()).optional().default([]),
  })
  .passthrough();

const DeduplicationDimension = z
  .object({
    verdict: DeduplicationVerdict,
    reasoning: z.string(),
    examples: z.array(z.string()).optional().default([]),
  })
  .passthrough();

const ScopePrecisionDimension = z
  .object({
    verdict: ScopePrecisionVerdict,
    reasoning: z.string(),
    examples: z.array(z.string()).optional().default([]),
  })
  .passthrough();

const ActionabilityDimension = z
  .object({
    verdict: ActionabilityVerdict,
    reasoning: z.string(),
    examples: z.array(z.string()).optional().default([]),
  })
  .passthrough();

// ── Brain Judgement Schema ────────────────────────────────────────────

export const BrainJudgementSchema = z
  .object({
    specQuality: SpecQualityDimension,
    hierarchyCoherence: HierarchyDimension,
    deduplication: DeduplicationDimension,
    scopePrecision: ScopePrecisionDimension,
    actionability: ActionabilityDimension,
  })
  .passthrough();

export type BrainJudgement = z.infer<typeof BrainJudgementSchema>;

// ── Judge Function ────────────────────────────────────────────────────

export async function judgeBrainQuality(brainMarkdown: string): Promise<BrainJudgement> {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = brainMarkdown;

  return callHaiku(systemPrompt, userPrompt, BrainJudgementSchema, {
    maxTokens: 4096,
  });
}

// ── Runner ────────────────────────────────────────────────────────────

export async function runBrainJudge(repoId: string, outDir?: string): Promise<BrainJudgement> {
  console.log(`Generating markdown for repo ${repoId}...`);
  const { brainMd, topics } = await generateAllMarkdown(repoId);

  const allContent = [
    brainMd,
    ...topics.map((t) => `\n---\n# Topic: ${t.slug}\n\n${t.content}`),
  ].join("\n");

  console.log(`Judging brain quality (${allContent.length} chars)...`);
  const judgement = await judgeBrainQuality(allContent);

  printJudgement(judgement);

  if (outDir) {
    const timestamp = Date.now();
    const outPath = path.join(outDir, `brain-judge-${timestamp}.json`);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(judgement, null, 2), "utf-8");
    console.log(`\nResults written to ${outPath}`);
  }

  return judgement;
}

// ── Helpers ───────────────────────────────────────────────────────────

function printJudgement(j: BrainJudgement): void {
  console.log("\n=== Brain Quality Judgement ===\n");

  const dimensions: Array<{ key: keyof BrainJudgement; label: string }> = [
    { key: "specQuality", label: "Spec Quality" },
    { key: "hierarchyCoherence", label: "Hierarchy Coherence" },
    { key: "deduplication", label: "Deduplication" },
    { key: "scopePrecision", label: "Scope Precision" },
    { key: "actionability", label: "Actionability" },
  ];

  for (const { key, label } of dimensions) {
    const dim = j[key] as { verdict: string; reasoning: string; examples?: string[] };
    console.log(`${label}: ${dim.verdict.toUpperCase()}`);
    console.log(`  ${dim.reasoning}`);
    if (dim.examples && dim.examples.length > 0) {
      console.log(`  Examples: ${dim.examples.join(", ")}`);
    }
    console.log();
  }
}

function buildSystemPrompt(): string {
  return `You are a quality judge for a codebase knowledge graph. Score the brain output on 5 dimensions.

For each dimension, provide a verdict (one of the allowed enum values), reasoning that cites specific topic names, and examples (best and worst topics for that dimension).

## Dimensions

1. **specQuality** — Does it read like a design doc or a changelog?
   - "design_doc": Topics describe intent, constraints, and design decisions like specs
   - "mixed": Some topics are spec-like, others just record what happened
   - "changelog": Topics mostly describe past changes, not current truth

2. **hierarchyCoherence** — Does the tree help an agent find the right spec fast?
   - "navigable": Clear hierarchy, agent can drill down to what it needs quickly
   - "shallow": Some structure but mostly flat, hard to navigate
   - "flat": No meaningful hierarchy, all topics at same level

3. **deduplication** — Are there specs that say the same thing?
   - "clean": Each concept has one home, minimal overlap
   - "some_overlap": Some repeated information across topics
   - "redundant": Multiple topics covering the same ground

4. **scopePrecision** — Does each spec cover exactly one concept?
   - "focused": Each topic has a clear, single responsibility
   - "broad": Some topics cover too much ground
   - "tangled": Topics mix unrelated concepts, hard to know where to look

5. **actionability** — Can an agent use this to write correct code?
   - "actionable": Specs are concrete enough to guide implementation
   - "vague": Specs describe things at too high a level
   - "useless": Specs don't help an agent understand what to do

Respond with ONLY a JSON object matching this structure:
{
  "specQuality": { "verdict": "<design_doc|mixed|changelog>", "reasoning": "<cite specific topics>", "examples": ["<topic name>", ...] },
  "hierarchyCoherence": { "verdict": "<navigable|shallow|flat>", "reasoning": "<cite specific topics>", "examples": ["<topic name>", ...] },
  "deduplication": { "verdict": "<clean|some_overlap|redundant>", "reasoning": "<cite specific topics>", "examples": ["<topic name>", ...] },
  "scopePrecision": { "verdict": "<focused|broad|tangled>", "reasoning": "<cite specific topics>", "examples": ["<topic name>", ...] },
  "actionability": { "verdict": "<actionable|vague|useless>", "reasoning": "<cite specific topics>", "examples": ["<topic name>", ...] }
}`;
}
