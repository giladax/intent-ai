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

// ── Zod Schema ──────────────────────────────────────────────────────

const AssignmentSchema = z.object({
  fragmentIndex: z.number(),
  targetSpec: z.string(),
  action: z.enum(["update", "create"]),
  parentSpec: z.string().optional(),
}).passthrough();

const MergeSchema = z.object({
  specs: z.array(z.string()),
  intoName: z.string(),
  parentSpec: z.string().optional(),
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

  const system = `You organize a knowledge graph for a coding agent.

PURPOSE: Given existing specs (topics) and new knowledge fragments, output a GraphPlan that describes how to restructure the knowledge tree.

RULES:
- Max tree depth: 3 levels (root → child → grandchild)
- Prefer 3-7 root specs
- Every fragment MUST be assigned — no orphans
- Prefer updating existing specs over creating new ones when the knowledge fits
- Merge specs when they share >70% of their files AND have similar insights
- When creating new specs, always specify parentSpec if it fits under an existing root
${isColdStart ? "- COLD START: No existing specs. Build an initial tree from fragments alone." : ""}

OUTPUT FORMAT:
Return a single JSON object with this exact structure:
{
  "assignments": [
    {
      "fragmentIndex": 0,
      "targetSpec": "spec name (existing or new)",
      "action": "update" | "create",
      "parentSpec": "parent spec name (optional, for new specs)"
    }
  ],
  "merges": [
    {
      "specs": ["spec A", "spec B"],
      "intoName": "merged spec name",
      "parentSpec": "parent spec name (optional)"
    }
  ],
  "splits": [
    {
      "spec": "spec to split",
      "into": [
        { "name": "new sub-spec", "insightIds": ["id1", "id2"] }
      ],
      "parentSpec": "parent spec name (optional)"
    }
  ]
}

- assignments: REQUIRED. One entry per fragment.
- merges: optional. Only when specs are highly overlapping.
- splits: optional. Only when a spec has grown too broad.

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
