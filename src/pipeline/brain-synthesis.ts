import { callSonnet } from "../llm/client.js";
import {
  buildBrainSynthesisPrompt,
  BrainSynthesisOutputSchema,
  type BrainSynthesisInput,
  type BrainSynthesisTopic,
} from "../llm/prompts/brain-synthesis.js";
import { getClient } from "../storage/connection.js";

/**
 * Synthesize brain topics from a single session's digest.
 * Loads the session's narrative, moments, outcomes, and files from DB.
 */
export async function synthesizeFromSession(
  sessionId: string,
  existingTopics?: BrainSynthesisInput["existingTopics"],
): Promise<BrainSynthesisTopic[]> {
  const sql = getClient();

  // Load narrative
  const [narrative] = await sql`
    SELECT summary, abandoned_directions FROM narratives WHERE session_id = ${sessionId}
  `;
  if (!narrative) throw new Error(`No narrative found for session ${sessionId}`);

  // Load arcs
  const arcs = await sql`
    SELECT title, resolution FROM narrative_arcs
    WHERE narrative_id = (SELECT id FROM narratives WHERE session_id = ${sessionId})
  `;

  // Load moments with UUIDs
  const moments = await sql`
    SELECT id, type, statement, agency, significance FROM moments
    WHERE session_id = ${sessionId} ORDER BY id
  `;

  // Load outcomes with files
  const outcomes = await sql`
    SELECT o.statement, COALESCE(array_agg(of.file_path) FILTER (WHERE of.file_path IS NOT NULL), '{}') as files
    FROM outcomes o
    LEFT JOIN outcome_files of ON of.outcome_id = o.id
    WHERE o.session_id = ${sessionId}
    GROUP BY o.id, o.statement
  `;

  // Collect files from normalized events (tool actions)
  const fileRows = await sql`
    SELECT DISTINCT unnest(files_affected) as file_path
    FROM normalized_events
    WHERE session_id = ${sessionId} AND files_affected IS NOT NULL
  `;

  const input: BrainSynthesisInput = {
    sessionNarrative: {
      summary: narrative.summary,
      arcs: arcs.map((a: any) => ({ title: a.title, resolution: a.resolution || "open" })),
      abandonedDirections: narrative.abandoned_directions || [],
    },
    moments: moments.map((m: any) => ({
      id: m.id,
      type: m.type,
      statement: m.statement,
      agency: m.agency || "collaborative",
      significance: m.significance || "",
    })),
    outcomes: outcomes.map((o: any) => ({
      statement: o.statement,
      files: o.files.filter((f: string) => f),
    })),
    filesTouched: fileRows.map((r: any) => r.file_path),
    existingTopics,
  };

  const { system, user } = buildBrainSynthesisPrompt(input);
  const result = await callSonnet(system, user, BrainSynthesisOutputSchema);

  return result.topics;
}

/**
 * Create a brain version record. Returns the version ID.
 */
export async function createBrainVersion(
  repoId: string,
  commitSha?: string,
): Promise<string> {
  const sql = getClient();

  // Find parent (latest version for this repo)
  const [latest] = await sql`
    SELECT id FROM brain_versions WHERE repo_id = ${repoId} ORDER BY created_at DESC LIMIT 1
  `;

  const [version] = await sql`
    INSERT INTO brain_versions (repo_id, commit_sha, parent_version_id)
    VALUES (${repoId}, ${commitSha || null}, ${latest?.id || null})
    RETURNING id
  `;

  return version.id;
}

/**
 * Store synthesized topics to Postgres.
 */
export async function storeTopics(
  repoId: string,
  sessionId: string,
  topics: BrainSynthesisTopic[],
  momentIdMap: Map<string, string>, // momentId from LLM → actual UUID
): Promise<void> {
  const sql = getClient();

  for (const topic of topics) {
    // Upsert topic
    const [existing] = await sql`
      SELECT id FROM topics WHERE repo_id = ${repoId} AND name = ${topic.name}
    `;

    let topicId: string;
    if (existing) {
      topicId = existing.id;
      await sql`
        UPDATE topics SET summary = ${topic.summary}, updated_at = NOW() WHERE id = ${topicId}
      `;
    } else {
      const [inserted] = await sql`
        INSERT INTO topics (repo_id, name, summary) VALUES (${repoId}, ${topic.name}, ${topic.summary}) RETURNING id
      `;
      topicId = inserted.id;
    }

    // Link topic to session
    await sql`
      INSERT INTO topic_sessions (topic_id, session_id) VALUES (${topicId}, ${sessionId})
      ON CONFLICT DO NOTHING
    `;

    // Store insights
    for (const insight of topic.insights) {
      const [ins] = await sql`
        INSERT INTO insights (topic_id, category, statement, confidence, status)
        VALUES (${topicId}, ${insight.category}, ${insight.statement}, ${insight.confidence}, 'active')
        RETURNING id
      `;

      // Store evidence refs (skip invalid moment UUIDs)
      for (const ev of insight.evidence) {
        const momentUuid = ev.momentId ? (momentIdMap.get(ev.momentId) || null) : null;
        await sql`
          INSERT INTO insight_evidence (insight_id, session_id, moment_id, reasoning)
          VALUES (${ins.id}, ${sessionId}, ${momentUuid}, ${ev.reasoning || null})
        `;
      }
    }

    // Store file refs
    for (const f of topic.fileRefs) {
      await sql`
        INSERT INTO topic_files (topic_id, file_path, role, session_id)
        VALUES (${topicId}, ${f.path}, ${f.role}, ${sessionId})
      `;
    }

    // Store related topic edges (deferred — only if both topics exist)
    for (const relName of topic.relatedTopics) {
      const [rel] = await sql`SELECT id FROM topics WHERE repo_id = ${repoId} AND name = ${relName}`;
      if (rel) {
        await sql`
          INSERT INTO topic_relations (topic_id, related_topic_id, relationship)
          VALUES (${topicId}, ${rel.id}, 'related')
          ON CONFLICT DO NOTHING
        `;
      }
    }
  }
}

/**
 * Load existing topics for a repo from DB (for merge context).
 */
export async function loadExistingTopics(repoId: string): Promise<BrainSynthesisInput["existingTopics"]> {
  const sql = getClient();

  const topicRows = await sql`
    SELECT id, name, summary FROM topics WHERE repo_id = ${repoId} ORDER BY created_at
  `;

  if (topicRows.length === 0) return undefined;

  const result = [];
  for (const t of topicRows) {
    const insightRows = await sql`
      SELECT category, statement FROM insights WHERE topic_id = ${t.id} AND status = 'active'
    `;
    result.push({
      name: t.name,
      summary: t.summary,
      insights: insightRows.map((i: any) => ({ category: i.category, statement: i.statement })),
    });
  }

  return result;
}

/**
 * Print topics for human review (EDD).
 */
export function printTopics(topics: BrainSynthesisTopic[]): void {
  for (const topic of topics) {
    console.log(`\n## ${topic.name}`);
    console.log(topic.summary);

    // Group insights by category
    const byCategory = new Map<string, typeof topic.insights>();
    for (const insight of topic.insights) {
      const list = byCategory.get(insight.category) || [];
      list.push(insight);
      byCategory.set(insight.category, list);
    }

    for (const [category, categoryInsights] of byCategory) {
      console.log(`\n### ${category}`);
      for (const insight of categoryInsights) {
        console.log(`- ${insight.statement}`);
        console.log(`  confidence: ${insight.confidence}%`);
        for (const ev of insight.evidence) {
          const ref = ev.momentId || ev.momentIndex;
          console.log(`  evidence: [moment ${ref}] ${ev.reasoning}`);
        }
      }
    }

    if (topic.fileRefs.length > 0) {
      console.log(`\n### files`);
      for (const f of topic.fileRefs) {
        console.log(`- ${f.path} — ${f.role}`);
      }
    }

    if (topic.relatedTopics.length > 0) {
      console.log(`\n### related: ${topic.relatedTopics.join(", ")}`);
    }

    console.log("\n" + "─".repeat(60));
  }
}
