import { z } from "zod";
import type { SpecCard } from "./brain-route.js";
import type { RouteOutput } from "./brain-route.js";
import type { SpecFragment } from "./brain-extract.js";

// ── Re-export types from gen2b for compatibility ───────────────────
export type { ExistingSpec, OrganizeSignals } from "./brain-organize.js";

// ── Zod Schema (Gen2B level schema + Gen3 routed input) ───────────

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

export function buildBrainOrganizeGen3Prompt(
  specCards: SpecCard[],
  fragments: SpecFragment[],
  routeData: RouteOutput,
): { system: string; user: string } {
  const isColdStart = specCards.length === 0;

  const system = `You are building a 2-level knowledge tree for a codebase. A coding agent navigates this tree to find context before writing code.

YOU HAVE PRE-COMPUTED ROUTING DATA. Each fragment has already been matched to its most relevant existing specs with confidence scores. Use this data — don't ignore it.

THE TREE HAS EXACTLY TWO LEVELS:
- ROOT specs are major project areas (2-4 total). Reading just the root names should tell you what the project does.
- CHILD specs are specific concepts within a root area. Every non-root spec MUST be a child.

HOW TO USE THE ROUTING DATA:
- Fragments routed as "high" to a spec → assign to that spec (update)
- Fragments routed as "partial" → evaluate if they should update the spec or create a new child
- Fragments with newTopicNeeded=true → create a new spec, decide if root or child
- If multiple fragments route to the same 2 specs → those specs may need merging

HOW TO DECIDE ROOT vs CHILD:
- If spec B only makes sense in the context of spec A, then B is a child of A
- If two specs describe the same subsystem from different angles, merge them
- Root specs are major areas: "Pipeline", "Knowledge Graph", "Developer Tools" — not specific features

${isColdStart ? "COLD START: No existing specs. Build the initial tree from fragments and routing alone.\n\n" : ""}OUTPUT FORMAT:
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
  "merges": [],
  "splits": []
}

RULES:
1. Every fragment MUST appear in assignments — no orphans
2. Every assignment MUST have a "level" field: "root" or "child"
3. parentSpec is REQUIRED when level is "child". A child without a parent is INVALID.
4. There should be 2-4 root specs total
5. Routing data is your primary guide — fragments were already matched semantically and by file overlap

Respond with valid JSON only.`;

  let user = "";

  // Existing specs (cards)
  if (specCards.length > 0) {
    user += `## Existing Specs (${specCards.length})\n\n`;
    for (const sc of specCards) {
      user += `### ${sc.name}${sc.parentSpec ? ` (child of: ${sc.parentSpec})` : " (root)"}\n`;
      user += `${sc.card}\n\n`;
    }
  } else {
    user += "## Existing Specs\n\nNone — cold start.\n\n";
  }

  // Fragments with routing data
  user += `## Fragments with Routing Data (${fragments.length})\n\n`;
  for (let i = 0; i < fragments.length; i++) {
    const f = fragments[i];
    const route = routeData.routes.find(r => r.fragmentIndex === i);

    user += `### Fragment ${i}: ${f.nameHint}\n`;
    user += `Insights: ${f.insights.map(ins => `[${ins.category}] ${ins.statement}`).join("; ")}\n`;
    if (f.fileRefs.length > 0) {
      user += `Files: ${f.fileRefs.map(r => r.path).join(", ")}\n`;
    }

    if (route) {
      user += `Routing:\n`;
      for (const m of route.topMatches.filter(m => m.relevance !== "none")) {
        user += `  → ${m.specName} (${m.relevance})${m.reasoning ? `: ${m.reasoning}` : ""}\n`;
      }
      if (route.newTopicNeeded) {
        user += `  → NEW TOPIC SUGGESTED: ${route.newTopicHint}\n`;
      }
    } else {
      user += `Routing: not available\n`;
    }
    user += "\n";
  }

  user += "Produce a GraphPlan as valid JSON. Use the routing data to guide assignments.";

  return { system, user };
}
