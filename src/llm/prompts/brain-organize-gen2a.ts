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

const ConceptGroupSchema = z.object({
  name: z.string(),
  description: z.string(),
  children: z.array(z.string()).optional().default([]),
}).passthrough();

export const GraphPlanSchema = z.object({
  conceptualMap: z.array(ConceptGroupSchema).optional().default([]),
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

  const system = `You organize a codebase knowledge graph. A coding agent will navigate this tree to find context before writing code.

You will work in TWO EXPLICIT PASSES within a single JSON response.

═══════════════════════════════════════════════════════════════
PASS 1: BUILD THE TREE SKELETON (conceptualMap)
═══════════════════════════════════════════════════════════════

UNDERSTAND THE PROJECT. Read all the specs and fragments. What is this project? What does it do? What are its major subsystems?

FIND THE NATURAL GROUPS. Which concepts are semantically close? What belongs together? Think about it like a developer explaining the project to a new teammate — you wouldn't list 7 disconnected topics, you'd say "there are two main systems: X which does A, and Y which does B."

Output your tree skeleton in conceptualMap. Each root MUST have children. A flat conceptualMap with no children is WRONG.

WHAT MAKES A GOOD TREE:
- Root nodes are major project areas (not individual features or files)
- Child nodes are specific concepts that live inside a parent area
- If concept B only makes sense in the context of concept A, then B is a child of A
- The tree should have 2-5 roots, each with 1-4 children — not 7 flat siblings

WHAT MAKES A BAD TREE:
- Everything at root level (flat list, no grouping)
- A root with an empty children array — EVERY root MUST have at least one child
- Topics named after what happened ("dashboard redesign") rather than what exists ("developer dashboard")
- A concept that is clearly part of a larger system sitting as a sibling instead of a child
- Redundant or overlapping specs that should be merged

═══════════════════════════════════════════════════════════════
PASS 2: ASSIGN FRAGMENTS TO THE TREE (assignments)
═══════════════════════════════════════════════════════════════

Now assign every fragment to a spec IN that tree. Look back at the conceptualMap you just built and use it as your guide.

HARD CONSTRAINTS — violating any of these makes your output invalid:
- Every targetSpec must appear in your conceptualMap — either as a root name or as a child name. No orphan specs.
- If your conceptualMap has children, those children MUST appear as targetSpecs with their parentSpec set. Your assignments must match your conceptualMap.
- If a spec is not a root in your map, set parentSpec to its parent (the root that lists it as a child).
- If a spec IS a root in your map, do NOT set parentSpec.
- Every fragment must be assigned — no orphans.

SELF-CHECK before finalizing:
1. List all children from your conceptualMap. Does each child appear as a targetSpec somewhere in assignments?
2. For each assignment with a targetSpec that is a child in conceptualMap, does parentSpec match the root that contains it?
3. Are there any targetSpecs that do NOT appear in conceptualMap? If yes, fix it.

${isColdStart ? "COLD START: No existing specs. Build the initial tree from fragments alone.\n\n" : ""}OUTPUT FORMAT:
{
  "conceptualMap": [
    {
      "name": "area name — the root concept",
      "description": "one sentence: what this area of the project is about",
      "children": ["child concept 1", "child concept 2"]
    }
  ],
  "assignments": [
    {
      "fragmentIndex": 0,
      "targetSpec": "spec name",
      "action": "update" | "create",
      "parentSpec": "parent spec name (required for non-root specs)"
    }
  ],
  "merges": [
    {
      "specs": ["spec A", "spec B"],
      "intoName": "merged spec name",
      "parentSpec": "parent spec name (optional)"
    }
  ],
  "splits": []
}

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
