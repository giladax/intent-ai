import { z } from "zod";

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

const TopicSchema = z.object({
  name: z.string(),
  summary: z.string().optional().default(""),
  description: z.string().optional(), // LLM sometimes uses "description" instead of "summary"
  insights: InsightsSchema,
  fileRefs: z.array(FileRefSchema).optional().default([]),
  files: z.array(z.any()).optional(), // LLM sometimes uses "files" instead of "fileRefs"
  relatedTopics: z.array(z.string()).optional().default([]),
}).passthrough().transform((t) => ({
  ...t,
  summary: t.summary || t.description || "",
  fileRefs: t.fileRefs.length > 0 ? t.fileRefs : (t.files || []).map((f: any) =>
    typeof f === "string" ? { path: f, role: "" } : { path: f.path || f, role: f.role || "" }
  ),
}));

export const BrainSynthesisOutputSchema = z.object({
  topics: z.array(TopicSchema),
});

export type BrainSynthesisTopic = z.infer<typeof TopicSchema>;
export type BrainSynthesisOutput = z.infer<typeof BrainSynthesisOutputSchema>;

// ── Prompt Builder ───────────────────────────────────────────────────

export interface BrainSynthesisInput {
  sessionNarrative: {
    summary: string;
    arcs: { title: string; resolution: string }[];
    abandonedDirections: string[];
  };
  moments: { id: string; type: string; statement: string; agency: string; significance: string }[];
  outcomes: { statement: string; files: string[] }[];
  filesTouched: string[];
  existingTopics?: { name: string; summary: string; insights: { category: string; statement: string }[] }[];
}

export function buildBrainSynthesisPrompt(input: BrainSynthesisInput): {
  system: string;
  user: string;
} {
  const { sessionNarrative, moments, outcomes, filesTouched, existingTopics } = input;

  const system = `You extract reusable CODEBASE knowledge from development session digests into topics.

PURPOSE: What patterns, decisions, and structures exist in this codebase that a coding agent needs to know?

A topic is a CONCEPT in the codebase — not a file, not a directory, not a session process.
Examples: "digestion pipeline", "cursor mechanism", "alert system", "database schema".

CRITICAL DISTINCTION:
- REPO KNOWLEDGE (extract this): "Pipeline uses two-pass moment detection with Sonnet"
- SESSION META (DO NOT extract): "The developer explored three approaches before settling on X"
- REPO KNOWLEDGE: "PostgreSQL chosen over SQLite for pgvector support"
- SESSION META: "The AI proposed multiple options and the developer picked one"

You are capturing what the CODEBASE became, not how the SESSION went.

Each topic has categorized insights:
- structure: how components connect — agent builds mental model
- decision: choices made and WHY — agent knows what NOT to undo
- constraint: hard rules — agent treats as law during code generation
- behavior: what happens at runtime — agent understands sequences/side effects
- risk: known issues, fragile areas — agent proceeds with caution
- interface: external contracts — agent must honor these

EVIDENCE REQUIREMENT:
Every insight must cite specific moments by their [id]. The evidence.momentId field must match a moment ID from the provided list. If you cannot tie an insight to a specific moment, do not include it.

Rules:
- 1-5 topics per session. Don't force more.
- Insights must be specific and actionable, not generic.
- File refs: only files mentioned in the session.
- Skip moments that don't contribute reusable codebase knowledge.

Respond with valid JSON only.`;

  let userPrompt = `## Session Digest

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
${filesTouched.length > 0 ? filesTouched.map((f) => `- ${f}`).join("\n") : "None identified"}`;

  if (existingTopics && existingTopics.length > 0) {
    userPrompt += `\n\n## Existing Brain State

The following topics already exist. You may:
- Add new insights to existing topics (reference them by name)
- Create new topics if this session introduces concepts not covered
- Mark existing insights as needing update if this session contradicts them

${existingTopics.map((t) => `### ${t.name}\n${t.summary}\nInsights:\n${t.insights.map((i) => `  - [${i.category}] ${i.statement}`).join("\n")}`).join("\n\n")}`;
  }

  userPrompt += `\n\nExtract topics with categorized insights. Respond with ONLY valid JSON in this exact format:
{
  "topics": [
    {
      "name": "topic name",
      "summary": "one paragraph description",
      "insights": [
        {
          "category": "structure|decision|constraint|behavior|risk|interface",
          "statement": "the insight",
          "evidence": [{ "momentId": "abc-123", "reasoning": "why this moment supports the insight" }],
          "confidence": 80
        }
      ],
      "fileRefs": [{ "path": "src/foo.ts", "role": "what this file does for the topic" }],
      "relatedTopics": ["other topic name"]
    }
  ]
}`;

  return { system, user: userPrompt };
}
