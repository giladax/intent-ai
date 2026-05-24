import { z } from "zod";
import type { SpecFragment } from "./brain-extract.js";

// ── Zod Schemas ──────────────────────────────────────────────────────

const InsightCategorySchema = z.enum([
  "structure",
  "decision",
  "constraint",
  "behavior",
  "risk",
  "interface",
]);

const FileRefSchema = z.object({
  path: z.string(),
  role: z.string(),
});

const EvidenceRefSchema = z.object({
  momentId: z.string().optional(),
  momentIndex: z.number().optional(), // fallback if LLM uses index
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

// WrittenSpecSchema — like TopicSchema but without relatedTopics
export const WrittenSpecSchema = z.object({
  name: z.string(),
  summary: z.string().optional().default(""),
  description: z.string().optional(), // LLM sometimes uses "description" instead of "summary"
  insights: InsightsSchema,
  fileRefs: z.array(FileRefSchema).optional().default([]),
  files: z.array(z.any()).optional(), // LLM sometimes uses "files" instead of "fileRefs"
}).passthrough().transform((t) => ({
  ...t,
  summary: t.summary || t.description || "",
  fileRefs: t.fileRefs.length > 0 ? t.fileRefs : (t.files || []).map((f: any) =>
    typeof f === "string" ? { path: f, role: "" } : { path: f.path || f, role: f.role || "" }
  ),
}));

export type WrittenSpec = z.infer<typeof WrittenSpecSchema>;

// ── Input Types ──────────────────────────────────────────────────────

export interface SpecWriteInput {
  specName: string;
  existingContent?: {
    summary: string;
    insights: { category: string; statement: string }[];
  };
  fragments: SpecFragment[];
  treeContext: {
    parentSpec?: { name: string; summary: string };
    childSpecs?: string[];
  };
}

// ── Prompt Builder ───────────────────────────────────────────────────

export function buildBrainWritePrompt(input: SpecWriteInput): {
  system: string;
  user: string;
} {
  const { specName, existingContent, fragments, treeContext } = input;

  const system = `You are writing a LIVING DESIGN DOCUMENT for a codebase concept.

PURPOSE: Produce a spec that tells a new developer joining the project what this concept IS, why it exists, and how it works — not what happened in a session.

CRITICAL DISTINCTION:
- DESIGN DOC (write this): "The pipeline uses two-pass moment detection because single-pass missed context shifts"
- SESSION CHANGELOG (do NOT write): "In session X the developer added two-pass detection"
- DESIGN DOC: "PostgreSQL is required over SQLite for pgvector — this is a hard constraint"
- SESSION CHANGELOG: "The developer switched from SQLite to PostgreSQL after evaluation"

You are writing the CODEBASE SPEC, not a session summary.

UPDATING vs CREATING:
- If existing content is provided, EVOLVE it — incorporate new knowledge, correct outdated claims, deepen explanations. Do not start over.
- If no existing content, write fresh from the fragment evidence.

TREE AWARENESS:
- If a parent spec is provided, reference it naturally — explain how this concept fits within the larger system.
- If child specs are listed, explicitly mention what they cover so this doc stays at the right level of abstraction.

WRITING QUALITY:
- Summary: A paragraph a new developer would actually read. Concrete, specific, no hand-waving.
- Insights must be specific and actionable, not generic platitudes.
- Every insight must cite momentIds from the provided fragments as evidence.

Insight categories:
- structure: how components connect — agent builds mental model
- decision: choices made and WHY — agent knows what NOT to undo
- constraint: hard rules — agent treats as law during code generation
- behavior: what happens at runtime — agent understands sequences/side effects
- risk: known issues, fragile areas — agent proceeds with caution
- interface: external contracts — agent must honor these

EVIDENCE REQUIREMENT:
Every insight must cite specific moments by their [id] from the fragments. The evidence.momentId field must reference a real momentId from the provided fragment evidence.

Respond with valid JSON only.`;

  let userPrompt = `## Spec to Write

**Spec Name:** ${specName}
`;

  // Existing content section (when updating)
  if (existingContent) {
    userPrompt += `
## Existing Spec Content (Evolve This — Do Not Discard)

**Current Summary:**
${existingContent.summary}

**Current Insights:**
${existingContent.insights.map((i) => `- [${i.category}] ${i.statement}`).join("\n")}
`;
  }

  // Tree context
  if (treeContext.parentSpec || (treeContext.childSpecs && treeContext.childSpecs.length > 0)) {
    userPrompt += `
## Tree Context

`;
    if (treeContext.parentSpec) {
      userPrompt += `**Parent Spec:** ${treeContext.parentSpec.name}
${treeContext.parentSpec.summary}

`;
    }
    if (treeContext.childSpecs && treeContext.childSpecs.length > 0) {
      userPrompt += `**Child Specs (covered at lower level — don't duplicate):**
${treeContext.childSpecs.map((c) => `- ${c}`).join("\n")}

`;
    }
  }

  // Fragments
  userPrompt += `## Assigned Knowledge Fragments

${fragments.map((frag, idx) => {
    const insightLines = (frag.insights as any[]).map((ins: any) =>
      `  - [${ins.category}] ${ins.statement}` +
      (ins.evidence && ins.evidence.length > 0
        ? `\n    Evidence: ${ins.evidence.map((e: any) => e.momentId ? `[${e.momentId}] ${e.reasoning || ""}` : e.reasoning || "implicit").join("; ")}`
        : "")
    ).join("\n");
    const fileLines = frag.fileRefs && frag.fileRefs.length > 0
      ? `\n  Files: ${frag.fileRefs.map((f) => `${f.path} (${f.role})`).join(", ")}`
      : "";
    return `### Fragment ${idx} — ${frag.nameHint || "(unnamed)"}
${insightLines}${fileLines}`;
  }).join("\n\n")}

Write the spec. Respond with ONLY valid JSON in this exact format:
{
  "name": "${specName}",
  "summary": "design-doc quality paragraph describing what this concept is, why it exists, and how it works",
  "insights": [
    {
      "category": "structure|decision|constraint|behavior|risk|interface",
      "statement": "specific, actionable insight",
      "evidence": [{ "momentId": "abc-123", "reasoning": "why this moment supports the insight" }],
      "confidence": 80
    }
  ],
  "fileRefs": [{ "path": "src/foo.ts", "role": "what this file does for this concept" }]
}`;

  return { system, user: userPrompt };
}
