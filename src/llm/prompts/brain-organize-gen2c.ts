import { z } from "zod";
import type { SpecFragment } from "./brain-extract.js";

// ── Input types ─────────────────────────────────────────────────────
// Re-export from original to keep interface identical

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

// ── Zod Schema (unchanged from original) ────────────────────────────

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

// ── Few-Shot Example ────────────────────────────────────────────────

const FEW_SHOT_EXAMPLE = `
EXAMPLE — here is what a well-organized output looks like for a hypothetical project:

Given fragments about database migrations, REST endpoints, a React dashboard, and a CLI tool, a good plan looks like:

\`\`\`json
{
  "conceptualMap": [
    {
      "name": "Backend Systems",
      "description": "Server-side infrastructure including data storage and API layer",
      "children": ["Database Layer", "API Server"]
    },
    {
      "name": "User Interface",
      "description": "All user-facing surfaces for interacting with the system",
      "children": ["Dashboard", "CLI"]
    }
  ],
  "assignments": [
    {
      "fragmentIndex": 0,
      "targetSpec": "Database Layer",
      "action": "create",
      "parentSpec": "Backend Systems"
    },
    {
      "fragmentIndex": 1,
      "targetSpec": "API Server",
      "action": "create",
      "parentSpec": "Backend Systems"
    },
    {
      "fragmentIndex": 2,
      "targetSpec": "Dashboard",
      "action": "create",
      "parentSpec": "User Interface"
    },
    {
      "fragmentIndex": 3,
      "targetSpec": "CLI",
      "action": "create",
      "parentSpec": "User Interface"
    },
    {
      "fragmentIndex": 4,
      "targetSpec": "Backend Systems",
      "action": "update"
    }
  ],
  "merges": [],
  "splits": []
}
\`\`\`

Notice how every non-root spec has parentSpec set, matching the conceptualMap structure. Root specs ("Backend Systems", "User Interface") have NO parentSpec. Child specs ("Database Layer", "API Server", "Dashboard", "CLI") ALWAYS have parentSpec pointing to their root. Fragment 4 targets a root spec directly, so it has no parentSpec.

END OF EXAMPLE.`;

// ── Prompt Builder ──────────────────────────────────────────────────

export function buildBrainOrganizePrompt(
  existingSpecs: ExistingSpec[],
  fragments: SpecFragment[],
  signals: OrganizeSignals,
): { system: string; user: string } {
  const isColdStart = existingSpecs.length === 0;

  const system = `You organize a codebase knowledge graph. A coding agent will navigate this tree to find context before writing code.

YOUR APPROACH — think like this:

1. UNDERSTAND THE PROJECT. Read all the specs and fragments. What is this project? What does it do? What are its major subsystems?

2. FIND THE NATURAL GROUPS. Which concepts are semantically close? What belongs together? Think about it like a developer explaining the project to a new teammate — you wouldn't list 7 disconnected topics, you'd say "there are two main systems: X which does A, and Y which does B, and they connect through Z."

3. BUILD A TREE THAT TELLS THE STORY. The tree should read like a table of contents. A root node is an AREA of the project. Its children are the CONCEPTS within that area. An agent reading just the root names should understand the project's architecture.

WHAT MAKES A GOOD TREE:
- Root nodes are major project areas (not individual features or files)
- Child nodes are specific concepts that live inside a parent area
- If concept B only makes sense in the context of concept A, then B is a child of A
- If two specs describe the same subsystem from different angles, merge them
- The tree should have 2-5 roots, each with 1-4 children — not 7 flat siblings

WHAT MAKES A BAD TREE:
- Everything at root level (flat list, no grouping)
- Topics named after what happened ("dashboard redesign") rather than what exists ("developer dashboard")
- A concept that is clearly part of a larger system sitting as a sibling instead of a child
- Redundant or overlapping specs that should be merged

${FEW_SHOT_EXAMPLE}

${isColdStart ? "COLD START: No existing specs. Build the initial tree from fragments alone.\n" : ""}OUTPUT FORMAT:
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

PROCESS:
1. First, fill conceptualMap — your understanding of the project's structure
2. Then, assign every fragment to a spec that lives in that structure
3. Merge existing specs that describe the same concept
4. Every fragment MUST be assigned — no orphans
5. parentSpec is REQUIRED for any spec that is not a root

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
