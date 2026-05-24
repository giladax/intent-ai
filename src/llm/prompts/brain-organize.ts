import { z } from "zod";
import type { SpecFragment } from "./brain-extract.js";

// ── Input types ─────────────────────────────────────────────────────

export interface ExistingSpec {
  name: string;
  summary: string;
  insightCount: number;
  fileList: string[];
  sessionCount: number;
  daysSinceUpdate: number;
}

export interface OrganizeSignals {
  sharedFileRatios: { specA: string; specB: string; ratio: number }[];
}

// ── Zod Schema (Gen2B: tree-first, no conceptualMap) ─────────────────

const AssignmentSchema = z.object({
  fragmentIndex: z.number(),
  targetSpec: z.string(),
  action: z.enum(["update", "create"]),
  level: z.enum(["root", "child"]),
  parentSpec: z.string().optional(),
}).passthrough();

const MergeSchema = z.object({
  specs: z.array(z.string()),
  intoName: z.string(),
  level: z.enum(["root", "child"]),
  parentSpec: z.string().nullable().optional(),
}).passthrough();

const SplitIntoSchema = z.object({
  name: z.string(),
  insightIds: z.array(z.string()),
}).passthrough();

const SplitSchema = z.object({
  spec: z.string(),
  into: z.array(SplitIntoSchema),
  parentSpec: z.string().optional(),
}).passthrough();

export const GraphPlanSchema = z.object({
  assignments: z.array(AssignmentSchema),
  merges: z.array(MergeSchema).optional().default([]),
  splits: z.array(SplitSchema).optional().default([]),
}).passthrough();

export type GraphPlan = z.infer<typeof GraphPlanSchema>;

// ── Prompt Builder ──────────────────────────────────────────────────

export function buildBrainOrganizePrompt(
  existingSpecs: ExistingSpec[],
  fragments: SpecFragment[],
  signals: OrganizeSignals,
): { system: string; user: string } {
  const isColdStart = existingSpecs.length === 0;

  const system = `You are building a 2-level knowledge tree for a codebase. A coding agent navigates this tree to find context before writing code.

THE TREE HAS EXACTLY TWO LEVELS:
- ROOT specs are major project areas (2-4 total). Reading just the root names should tell you what the project does.
- CHILD specs are specific concepts within a root area. Every spec that is not a root MUST be a child.

HOW TO DECIDE:
- If spec B only makes sense in the context of spec A, then B is a child of A.
- Example: "Moment Detection" is a child of "Pipeline" because it's a specific stage within the pipeline.
- Example: "Pipeline" is a root because it's a major subsystem of the project.
- If two specs describe the same concept from different angles, merge them.

YOUR APPROACH:
1. UNDERSTAND THE PROJECT. Read all specs and fragments. What are the 2-4 major areas?
2. ASSIGN EVERY FRAGMENT. Each fragment becomes part of a spec. Each spec is either root or child.
3. ENFORCE THE TREE. There should be 2-4 root specs. Every other spec is a child with a parentSpec.

${isColdStart ? "COLD START: No existing specs. Build the initial tree from fragments alone.\n\n" : ""}OUTPUT FORMAT:
{
  "assignments": [
    {
      "fragmentIndex": 0,
      "targetSpec": "spec name",
      "action": "update" | "create",
      "level": "root" | "child",
      "parentSpec": "parent spec name (REQUIRED when level is child)"
    }
  ],
  "merges": [
    {
      "specs": ["spec A", "spec B"],
      "intoName": "merged spec name",
      "level": "root" | "child",
      "parentSpec": "parent spec name (REQUIRED when level is child)"
    }
  ],
  "splits": []
}

RULES:
1. Every fragment MUST appear in assignments — no orphans
2. Every assignment MUST have a "level" field: "root" or "child"
3. parentSpec is REQUIRED when level is "child". A child without a parent is INVALID.
4. parentSpec must reference a root-level spec (either existing or being created in this plan)
5. There should be 2-4 root specs total. If you have more, you're not grouping enough.
6. Do NOT include a conceptualMap field — the tree structure is expressed through level + parentSpec on each assignment

Respond with valid JSON only.`;

  let user = "";

  // Existing specs section
  if (existingSpecs.length > 0) {
    user += `## Existing Specs (${existingSpecs.length})\n\n`;
    for (const spec of existingSpecs) {
      user += `### ${spec.name}\n`;
      user += `Summary: ${spec.summary}\n`;
      user += `Insights: ${spec.insightCount} | Sessions: ${spec.sessionCount} | Last updated: ${spec.daysSinceUpdate} days ago\n`;
      if (spec.fileList.length > 0) {
        user += `Files: ${spec.fileList.join(", ")}\n`;
      }
      user += "\n";
    }
  } else {
    user += "## Existing Specs\n\nNone — this is a cold start. Build the initial tree from the fragments below.\n\n";
  }

  // Shared file ratios
  if (signals.sharedFileRatios.length > 0) {
    user += "## Shared File Ratios\n\n";
    for (const r of signals.sharedFileRatios) {
      user += `- ${r.specA} ↔ ${r.specB}: ${(r.ratio * 100).toFixed(0)}% overlap\n`;
    }
    user += "\n";
  }

  // New fragments
  user += `## New Fragments (${fragments.length})\n\n`;
  for (let i = 0; i < fragments.length; i++) {
    const f = fragments[i];
    user += `### Fragment ${i}: ${f.nameHint || "(no name hint)"}\n`;
    user += `Insights (${f.insights.length}):\n`;
    for (const ins of f.insights) {
      user += `  - [${ins.category}] ${ins.statement}\n`;
    }
    if (f.fileRefs.length > 0) {
      user += `Files: ${f.fileRefs.map((r: { path: string; role: string }) => r.path).join(", ")}\n`;
    }
    user += "\n";
  }

  user += "Produce a GraphPlan as valid JSON. Every fragment must appear in assignments.";

  return { system, user };
}
