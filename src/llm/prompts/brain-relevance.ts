import { z } from "zod";

// ── Zod Schemas ──────────────────────────────────────────────────────

const TopicRelevanceSchema = z.object({
  topicName: z.string(),
  relevance: z.enum(["high", "low", "none"]),
  reasoning: z.string().optional().default(""),
}).passthrough();

export const BrainRelevanceOutputSchema = z.object({
  topicRelevance: z.array(TopicRelevanceSchema),
  newTopicSuggestions: z.array(z.string()).optional().default([]),
}).passthrough();

export type BrainRelevanceOutput = z.infer<typeof BrainRelevanceOutputSchema>;

// ── Prompt Builder ───────────────────────────────────────────────────

export interface RelevanceClassificationInput {
  topic: {
    name: string;
    summary: string;
    insights: { category: string; statement: string }[];
  };
  sessionSignals: {
    narrativeSummary: string;
    arcs: { title: string; resolution: string }[];
    momentStatements: string[];
    outcomeStatements: string[];
    chunkTopicHints: string[];
  };
}

export interface BatchRelevanceInput {
  topics: {
    name: string;
    summary: string;
    insights: { category: string; statement: string }[];
  }[];
  sessionSignals: {
    narrativeSummary: string;
    arcs: { title: string; resolution: string }[];
    momentStatements: string[];
    outcomeStatements: string[];
    chunkTopicHints: string[];
  };
}

export function buildBrainRelevancePrompt(input: BatchRelevanceInput): {
  system: string;
  user: string;
} {
  const { topics, sessionSignals } = input;

  const system = `You are a relevance classifier for a codebase knowledge system.

Given a development session's signals (narrative, moments, outcomes, chunk topics) and a set of existing brain topics, determine how relevant the session is to EACH topic.

RELEVANCE LEVELS:
- "high": The session directly works on, modifies, or significantly discusses this topic. The session would ADD new insights to this topic.
- "low": The session touches this topic tangentially — mentions it, uses it as context, or makes minor changes related to it. The session might slightly update existing insights but doesn't fundamentally change them.
- "none": The session has no meaningful connection to this topic.

GUIDELINES:
- A session about building a web dashboard is "none" for a topic about moment detection, unless the dashboard specifically displays or interacts with moments.
- A session that refactors the pipeline is "high" for pipeline topics but may be "low" for eval topics if it affects eval indirectly.
- Be conservative with "high" — only use it when the session clearly advances or modifies the topic's knowledge.

Also identify NEW TOPIC CANDIDATES: concepts from the session that don't fit any existing topic. These should be codebase concepts (not session-process descriptions).

Respond with valid JSON only.`;

  let userPrompt = `## Session Signals

**Narrative Summary:** ${sessionSignals.narrativeSummary}

**Arcs:**
${sessionSignals.arcs.length > 0 ? sessionSignals.arcs.map((a) => `- ${a.title} (${a.resolution})`).join("\n") : "None"}

**Key Moments:**
${sessionSignals.momentStatements.length > 0 ? sessionSignals.momentStatements.map((m) => `- ${m}`).join("\n") : "None"}

**Accepted Outcomes:**
${sessionSignals.outcomeStatements.length > 0 ? sessionSignals.outcomeStatements.map((o) => `- ${o}`).join("\n") : "None"}

**Chunk Topics:**
${sessionSignals.chunkTopicHints.length > 0 ? sessionSignals.chunkTopicHints.map((t) => `- ${t}`).join("\n") : "None"}

## Existing Brain Topics

${topics.map((t) => `### ${t.name}
${t.summary}
Insights:
${t.insights.map((i) => `  - [${i.category}] ${i.statement}`).join("\n")}`).join("\n\n")}

## Task

For EACH topic above, classify the session's relevance. Then suggest any new topics the session introduces that aren't covered.

Respond with ONLY valid JSON:
{
  "topicRelevance": [
    {
      "topicName": "exact topic name",
      "relevance": "high|low|none",
      "reasoning": "why this relevance level"
    }
  ],
  "newTopicSuggestions": ["concept not covered by existing topics"]
}`;

  return { system, user: userPrompt };
}
