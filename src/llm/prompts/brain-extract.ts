import { z } from "zod";
import type { BrainSynthesisInput } from "./brain-synthesis.js";

// ── Input type (re-export for convenience) ──────────────────────────
// Fragments don't need existingTopics — just re-use the base input type
// and omit existingTopics in the prompt builder.
export type BrainExtractInput = Omit<BrainSynthesisInput, "existingTopics">;

// ── Zod Schemas ──────────────────────────────────────────────────────

const InsightCategorySchema = z.enum([
  "structure",
  "decision",
  "constraint",
  "behavior",
  "risk",
  "interface",
  "navigation",
  "pitfall",
]);

const FileRefSchema = z.object({
  path: z.string(),
  role: z.string(),
});

const EvidenceRefSchema = z.object({
  momentId: z.string().optional(),
  momentIndex: z.number().optional(),
  reasoning: z.string().optional().default(""),
}).passthrough();

const InsightSchema = z.object({
  category: InsightCategorySchema,
  statement: z.string(),
  evidence: z.union([
    z.array(EvidenceRefSchema),
    z.string().transform((s) => [{ reasoning: s }]),
  ]).optional().default([{ reasoning: "implicit" }]),
  confidence: z.number().min(0).max(100).optional().default(80),
}).passthrough();

// Accept insights as flat array OR as object grouped by category
const InsightsSchema = z.union([
  z.array(InsightSchema),
  z.record(z.string(), z.union([
    z.array(z.any()),
    z.string(),
  ])).transform((obj) => {
    const result: z.infer<typeof InsightSchema>[] = [];
    for (const [cat, items] of Object.entries(obj)) {
      if (Array.isArray(items)) {
        for (const item of items) {
          if (typeof item === "string") {
            result.push({ category: cat as any, statement: item, evidence: [{ reasoning: "implicit" }], confidence: 80 });
          } else {
            result.push({ ...item, category: item.category || cat });
          }
        }
      } else if (typeof items === "string") {
        result.push({ category: cat as any, statement: items, evidence: [{ reasoning: "implicit" }], confidence: 80 });
      }
    }
    return result;
  }),
]);

const SpecFragmentSchema = z.object({
  nameHint: z.string().optional().default(""),
  name: z.string().optional(), // alias for nameHint
  insights: InsightsSchema,
  fileRefs: z.array(FileRefSchema).optional().default([]),
  files: z.array(z.any()).optional(), // alias for fileRefs
  requests: z.array(z.object({
    statement: z.string(),
    momentIds: z.array(z.string()).optional().default([]),
  })).optional().default([]),
  struggles: z.array(z.object({
    statement: z.string(),
    momentIds: z.array(z.string()).optional().default([]),
  })).optional().default([]),
  fileSequences: z.array(z.object({
    files: z.array(z.string()),
    context: z.string(),
  })).optional().default([]),
}).passthrough().transform((f) => ({
  ...f,
  nameHint: f.nameHint || f.name || "",
  fileRefs: f.fileRefs.length > 0 ? f.fileRefs : (f.files || []).map((file: any) =>
    typeof file === "string" ? { path: file, role: "" } : { path: file.path || file, role: file.role || "" }
  ),
}));

export const SpecFragmentOutputSchema = z.object({
  fragments: z.array(SpecFragmentSchema),
});

export type SpecFragment = z.infer<typeof SpecFragmentSchema>;
export type SpecFragmentOutput = z.infer<typeof SpecFragmentOutputSchema>;

// ── Prompt Builder ───────────────────────────────────────────────────

export function buildBrainExtractPrompt(input: BrainExtractInput): {
  system: string;
  user: string;
} {
  const { sessionNarrative, moments, outcomes, filesTouched } = input;

  const system = `You extract raw CODEBASE knowledge fragments from development session digests.

PURPOSE: What patterns, decisions, and structures exist in this codebase that a coding agent needs to know?

A fragment is a RAW KNOWLEDGE UNIT — not a finished topic, not a hierarchy. Just the essential insights from this session, grouped by the concept they describe.

CRITICAL DISTINCTION:
- REPO KNOWLEDGE (extract this): "Pipeline uses two-pass moment detection with Sonnet"
- SESSION META (DO NOT extract): "The developer explored three approaches before settling on X"
- REPO KNOWLEDGE: "PostgreSQL chosen over SQLite for pgvector support"
- SESSION META: "The AI proposed multiple options and the developer picked one"

You are capturing what the CODEBASE became, not how the SESSION went.

Each fragment has categorized insights:
- structure: how components connect — agent builds mental model
- decision: choices made and WHY — agent knows what NOT to undo
- constraint: hard rules — agent treats as law during code generation
- behavior: what happens at runtime — agent understands sequences/side effects
- risk: known issues, fragile areas — agent proceeds with caution
- interface: external contracts — agent must honor these

EVIDENCE REQUIREMENT:
Every insight must cite specific moments by their [id]. The evidence.momentId field must match a moment ID from the provided list. If you cannot tie an insight to a specific moment, do not include it.

Rules:
- 1-5 fragments per session. Don't force more.
- Insights must be specific and actionable, not generic.
- File refs: only files mentioned in the session.
- Skip moments that don't contribute reusable codebase knowledge.
- NO relatedTopics, NO hierarchy — just raw material.

## ALSO EXTRACT: Agent Behavior Signals

For each fragment, also extract:

### requests[]
What was the agent asked to do or find? Direct requests from the developer.
- "find where auth is handled"
- "add a new pipeline node"
- "explain the chunking logic"
Each request needs the momentId(s) where it appeared.

### struggles[]
Where did the agent struggle, retry, or make mistakes?
- "opened wrong file first"
- "forgot to update types.ts after schema change"
- "had to retry migration 3 times"
Each struggle needs the momentId(s) where it was observed.

### fileSequences[]
What files were accessed together, in what order, for what purpose?
- files: ["types.ts", "orchestrator.ts"], context: "adding a pipeline node"
Only include sequences of 2+ files that represent a meaningful workflow.

Respond with valid JSON only.`;

  const user = `## Session Digest

**Summary:** ${sessionNarrative.summary}

**Arcs:**
${sessionNarrative.arcs.map((a) => `- ${a.title} (${a.resolution})`).join("\n")}

**Abandoned directions:**
${sessionNarrative.abandonedDirections.length > 0 ? sessionNarrative.abandonedDirections.map((d) => `- ${d}`).join("\n") : "None"}

**Moments:**
${moments.map((m) => `[${m.id}] (${m.type}, ${m.agency}) ${m.statement}\n    Significance: ${m.significance}`).join("\n")}

**Accepted outcomes:**
${outcomes.map((o) => `- ${o.statement}${o.files.length > 0 ? ` (files: ${o.files.join(", ")})` : ""}`).join("\n")}

**Files touched in this session:**
${filesTouched.length > 0 ? filesTouched.map((f) => `- ${f}`).join("\n") : "None identified"}

Extract knowledge fragments with categorized insights. Respond with ONLY valid JSON in this exact format:
{
  "fragments": [
    {
      "nameHint": "suggested spec name",
      "insights": [
        {
          "category": "structure|decision|constraint|behavior|risk|interface|navigation|pitfall",
          "statement": "the insight",
          "evidence": [{ "momentId": "abc-123", "reasoning": "why this moment supports the insight" }],
          "confidence": 80
        }
      ],
      "fileRefs": [{ "path": "src/foo.ts", "role": "what this file does" }],
      "requests": [{ "statement": "what the developer asked", "momentIds": ["abc-123"] }],
      "struggles": [{ "statement": "where the agent had difficulty", "momentIds": ["abc-123"] }],
      "fileSequences": [{ "files": ["src/types.ts", "src/orchestrator.ts"], "context": "adding a pipeline node" }]
    }
  ]
}`;

  return { system, user };
}
