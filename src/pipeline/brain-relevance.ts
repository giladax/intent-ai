import { callHaiku } from "../llm/client.js";
import {
  buildBrainRelevancePrompt,
  BrainRelevanceOutputSchema,
  type BatchRelevanceInput,
} from "../llm/prompts/brain-relevance.js";
import { getClient } from "../storage/connection.js";

// ── Types ────────────────────────────────────────────────────────────

export interface TopicRelevance {
  topicId: string;
  topicName: string;
  relevance: "high" | "low" | "none";
  reasoning: string;
}

export interface RelevanceResult {
  sessionId: string;
  topicRelevances: TopicRelevance[];
  newTopicSuggestions: string[];
}

// ── Main Function ────────────────────────────────────────────────────

/**
 * Classify how a digested session relates to existing brain topics.
 * Uses Haiku for cheap, fast classification.
 */
export async function classifyRelevance(
  sessionId: string,
  repoId: string,
): Promise<RelevanceResult> {
  const sql = getClient();

  // Load existing topics with insights
  const topicRows = await sql`
    SELECT id, name, summary FROM topics WHERE repo_id = ${repoId} ORDER BY created_at
  `;

  if (topicRows.length === 0) {
    return { sessionId, topicRelevances: [], newTopicSuggestions: [] };
  }

  const topics: BatchRelevanceInput["topics"] = [];
  for (const t of topicRows) {
    const insightRows = await sql`
      SELECT category, statement FROM insights WHERE topic_id = ${t.id} AND status = 'active'
    `;
    topics.push({
      name: t.name,
      summary: t.summary,
      insights: insightRows.map((i: any) => ({ category: i.category, statement: i.statement })),
    });
  }

  // Load session signals
  const sessionSignals = await loadSessionSignals(sessionId);

  // Single batch call to Haiku with all topics
  const input: BatchRelevanceInput = { topics, sessionSignals };
  const { system, user } = buildBrainRelevancePrompt(input);
  const result = await callHaiku(system, user, BrainRelevanceOutputSchema);

  // Map topic names back to IDs
  const topicIdMap = new Map(topicRows.map((t: any) => [t.name, t.id]));
  const topicRelevances: TopicRelevance[] = result.topicRelevance.map((tr) => ({
    topicId: topicIdMap.get(tr.topicName) || "",
    topicName: tr.topicName,
    relevance: tr.relevance,
    reasoning: tr.reasoning,
  }));

  return {
    sessionId,
    topicRelevances,
    newTopicSuggestions: result.newTopicSuggestions,
  };
}

// ── Session Signal Loading ──────────────────────────────────────────

async function loadSessionSignals(sessionId: string): Promise<BatchRelevanceInput["sessionSignals"]> {
  const sql = getClient();

  // Load narrative
  const [narrative] = await sql`
    SELECT summary FROM narratives WHERE session_id = ${sessionId}
  `;

  // Load arcs
  const arcs = await sql`
    SELECT title, resolution FROM narrative_arcs
    WHERE narrative_id = (SELECT id FROM narratives WHERE session_id = ${sessionId})
  `;

  // Load moment statements
  const moments = await sql`
    SELECT statement FROM moments WHERE session_id = ${sessionId} ORDER BY id
  `;

  // Load outcome statements
  const outcomes = await sql`
    SELECT statement FROM outcomes WHERE session_id = ${sessionId}
  `;

  // Load chunk topic hints
  const chunks = await sql`
    SELECT topic_hint FROM chunks WHERE session_id = ${sessionId} ORDER BY chunk_index
  `;

  return {
    narrativeSummary: narrative?.summary || "No narrative available",
    arcs: arcs.map((a: any) => ({ title: a.title, resolution: a.resolution || "open" })),
    momentStatements: moments.map((m: any) => m.statement),
    outcomeStatements: outcomes.map((o: any) => o.statement),
    chunkTopicHints: chunks.map((c: any) => c.topic_hint).filter(Boolean),
  };
}

// ── Display ─────────────────────────────────────────────────────────

export function printRelevanceResult(result: RelevanceResult): void {
  console.log(`\nSession: ${result.sessionId}`);
  console.log("=".repeat(60));

  const grouped = { high: [] as TopicRelevance[], low: [] as TopicRelevance[], none: [] as TopicRelevance[] };
  for (const tr of result.topicRelevances) {
    grouped[tr.relevance].push(tr);
  }

  if (grouped.high.length > 0) {
    console.log("\n  HIGH relevance:");
    for (const tr of grouped.high) {
      console.log(`    [HIGH] ${tr.topicName}`);
      console.log(`           ${tr.reasoning}`);
    }
  }

  if (grouped.low.length > 0) {
    console.log("\n  LOW relevance:");
    for (const tr of grouped.low) {
      console.log(`    [LOW]  ${tr.topicName}`);
      console.log(`           ${tr.reasoning}`);
    }
  }

  if (grouped.none.length > 0) {
    console.log("\n  NO relevance:");
    for (const tr of grouped.none) {
      console.log(`    [NONE] ${tr.topicName}`);
      console.log(`           ${tr.reasoning}`);
    }
  }

  if (result.newTopicSuggestions.length > 0) {
    console.log("\n  New topic candidates:");
    for (const suggestion of result.newTopicSuggestions) {
      console.log(`    + ${suggestion}`);
    }
  }

  console.log();
}
