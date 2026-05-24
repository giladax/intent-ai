import { callSonnet, callHaiku } from "../llm/client.js";
import {
  buildBrainSynthesisPrompt,
  BrainSynthesisOutputSchema,
  type BrainSynthesisInput,
  type BrainSynthesisTopic,
} from "../llm/prompts/brain-synthesis.js";
import { buildBrainExtractPrompt, SpecFragmentOutputSchema, type SpecFragment } from "../llm/prompts/brain-extract.js";
import { buildBrainOrganizePrompt, GraphPlanSchema, type ExistingSpec, type OrganizeSignals, type GraphPlan } from "../llm/prompts/brain-organize.js";
import { buildBrainWritePrompt, WrittenSpecSchema, type WrittenSpec, type SpecWriteInput } from "../llm/prompts/brain-write.js";
import { applyGraphPlan, normalizeName } from "./brain-apply.js";
import { generateCard } from "../brain/cards.js";
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

// ── V2 Pipeline ─────────────────────────────────────────────────────

/**
 * Extract knowledge fragments from a single session's digest.
 * Loads the same data as synthesizeFromSession, but calls the extract prompt (Node 1).
 */
async function extractFromSession(sessionId: string): Promise<SpecFragment[]> {
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

  const input = {
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
  };

  const { system, user } = buildBrainExtractPrompt(input);
  const result = await callSonnet(system, user, SpecFragmentOutputSchema);

  return result.fragments;
}

/**
 * Load existing specs for the organize node.
 * Returns enriched spec metadata needed for the Haiku organizer.
 */
async function loadExistingSpecsForOrganize(repoId: string): Promise<ExistingSpec[]> {
  const sql = getClient();

  const topicRows = await sql`
    SELECT
      t.id, t.name, t.summary, t.updated_at,
      (SELECT COUNT(*) FROM insights WHERE topic_id = t.id AND status = 'active') as insight_count,
      (SELECT COUNT(DISTINCT session_id) FROM topic_sessions WHERE topic_id = t.id) as session_count
    FROM topics t
    WHERE t.repo_id = ${repoId}
    ORDER BY t.created_at
  `;

  const result: ExistingSpec[] = [];
  for (const t of topicRows) {
    const fileRows = await sql`
      SELECT DISTINCT file_path FROM topic_files WHERE topic_id = ${t.id}
    `;
    const daysSinceUpdate = Math.floor(
      (Date.now() - new Date(t.updated_at).getTime()) / (1000 * 60 * 60 * 24),
    );
    result.push({
      name: t.name,
      summary: t.summary,
      insightCount: Number(t.insight_count),
      fileList: fileRows.map((r: any) => r.file_path),
      sessionCount: Number(t.session_count),
      daysSinceUpdate,
    });
  }

  return result;
}

/**
 * Compute signals for the organize node.
 * Calculates Jaccard similarity of file sets between all topic pairs.
 */
async function computeSignals(repoId: string, specs: ExistingSpec[]): Promise<OrganizeSignals> {
  const sharedFileRatios: OrganizeSignals["sharedFileRatios"] = [];

  for (let i = 0; i < specs.length; i++) {
    for (let j = i + 1; j < specs.length; j++) {
      const filesA = new Set(specs[i].fileList);
      const filesB = new Set(specs[j].fileList);
      if (filesA.size === 0 && filesB.size === 0) continue;

      const intersection = [...filesA].filter((f) => filesB.has(f)).length;
      const union = new Set([...filesA, ...filesB]).size;
      const ratio = union > 0 ? intersection / union : 0;

      if (ratio > 0) {
        sharedFileRatios.push({
          specA: specs[i].name,
          specB: specs[j].name,
          ratio,
        });
      }
    }
  }

  return { sharedFileRatios };
}

/**
 * From the GraphPlan, identify which specs need to be written/rewritten.
 * Returns SpecWriteInput[] for Node 3.
 */
function identifyChangedSpecs(
  plan: GraphPlan,
  existingSpecs: ExistingSpec[],
  allFragments: SpecFragment[],
): SpecWriteInput[] {
  const existingByName = new Map<string, ExistingSpec>();
  for (const s of existingSpecs) {
    existingByName.set(normalizeName(s.name), s);
  }

  // Group fragments by target spec
  const fragmentsBySpec = new Map<string, { specName: string; fragments: SpecFragment[]; action: string; parentSpec?: string }>();

  for (const a of plan.assignments) {
    const norm = normalizeName(a.targetSpec);
    if (!fragmentsBySpec.has(norm)) {
      fragmentsBySpec.set(norm, { specName: a.targetSpec, fragments: [], action: a.action, parentSpec: a.parentSpec });
    }
    const entry = fragmentsBySpec.get(norm)!;
    if (a.fragmentIndex >= 0 && a.fragmentIndex < allFragments.length) {
      entry.fragments.push(allFragments[a.fragmentIndex]);
    }
  }

  // Add merge targets
  for (const m of plan.merges) {
    const norm = normalizeName(m.intoName);
    if (!fragmentsBySpec.has(norm)) {
      fragmentsBySpec.set(norm, { specName: m.intoName, fragments: [], action: "update", parentSpec: m.parentSpec });
    }
  }

  // Add split targets
  for (const s of plan.splits) {
    for (const into of s.into) {
      const norm = normalizeName(into.name);
      if (!fragmentsBySpec.has(norm)) {
        fragmentsBySpec.set(norm, { specName: into.name, fragments: [], action: "create", parentSpec: s.parentSpec });
      }
    }
  }

  const result: SpecWriteInput[] = [];
  for (const [norm, entry] of fragmentsBySpec) {
    const existing = existingByName.get(norm);
    const existingContent = existing
      ? { summary: existing.summary, insights: [] as { category: string; statement: string }[] }
      : undefined;

    // Load existing insight text for updates
    if (existingContent && existing) {
      // We don't have insight details in ExistingSpec, so leave insights empty
      // The write prompt will work with the summary + new fragments
    }

    // Determine parent context
    const parentSpecName = entry.parentSpec;
    const parentExisting = parentSpecName ? existingByName.get(normalizeName(parentSpecName)) : undefined;

    // Determine child specs from the plan
    const childSpecs: string[] = [];
    for (const [otherNorm, otherEntry] of fragmentsBySpec) {
      if (otherEntry.parentSpec && normalizeName(otherEntry.parentSpec) === norm) {
        childSpecs.push(otherEntry.specName);
      }
    }

    result.push({
      specName: entry.specName,
      existingContent,
      fragments: entry.fragments,
      treeContext: {
        parentSpec: parentExisting
          ? { name: parentExisting.name, summary: parentExisting.summary }
          : parentSpecName
            ? { name: parentSpecName, summary: "" }
            : undefined,
        childSpecs: childSpecs.length > 0 ? childSpecs : undefined,
      },
    });
  }

  return result;
}

/**
 * V2 brain synthesis pipeline: Extract → Organize → Write.
 *
 * Wires the three-node pipeline:
 * 1. Extract fragments from all sessions in parallel (Sonnet)
 * 2. Organize fragments into a graph plan (Haiku)
 * 3. Write changed specs in parallel (Sonnet)
 */
export async function synthesizeV2(
  sessionIds: string[],
  repoId: string,
  opts?: { dryRun?: boolean },
): Promise<{ plan: GraphPlan; specs: WrittenSpec[] }> {
  const sql = getClient();

  // ── Node 1: Extract fragments from all sessions in parallel ──────
  console.log(`  Extracting fragments from ${sessionIds.length} session(s)...`);
  const fragmentArrays = await Promise.all(
    sessionIds.map((id) => extractFromSession(id)),
  );
  const allFragments = fragmentArrays.flat();
  console.log(`  Extracted ${allFragments.length} fragments total.`);

  // ── Load existing specs + compute signals ────────────────────────
  const existingSpecs = await loadExistingSpecsForOrganize(repoId);
  const signals = await computeSignals(repoId, existingSpecs);
  console.log(`  ${existingSpecs.length} existing specs, ${signals.sharedFileRatios.length} file-overlap pairs.`);

  // ── Node 2: Organize (single Haiku call) ─────────────────────────
  console.log("  Organizing into graph plan...");
  const { system: orgSystem, user: orgUser } = buildBrainOrganizePrompt(existingSpecs, allFragments, signals);
  const plan = await callHaiku(orgSystem, orgUser, GraphPlanSchema);
  console.log(`  Plan: ${plan.assignments.length} assignments, ${plan.merges.length} merges, ${plan.splits.length} splits.`);

  // ── Node 3: Write changed specs in parallel ──────────────────────
  const specInputs = identifyChangedSpecs(plan, existingSpecs, allFragments);
  console.log(`  Writing ${specInputs.length} specs...`);

  const writtenSpecs = await Promise.all(
    specInputs.map(async (input) => {
      const { system, user } = buildBrainWritePrompt(input);
      return callSonnet(system, user, WrittenSpecSchema);
    }),
  );

  // ── Apply to DB (unless dry-run) ─────────────────────────────────
  if (!opts?.dryRun) {
    // Build moment ID map from all sessions
    const momentIdMap = new Map<string, string>();
    for (const sessionId of sessionIds) {
      const momentRows = await sql`SELECT id FROM moments WHERE session_id = ${sessionId} ORDER BY id`;
      for (const m of momentRows) {
        momentIdMap.set(m.id, m.id);
      }
    }

    // Use the first session ID as the "source" session for DB records
    await applyGraphPlan(repoId, sessionIds[0], plan, writtenSpecs, momentIdMap);

    // Link all sessions to their assigned topics
    for (const sessionId of sessionIds.slice(1)) {
      for (const a of plan.assignments) {
        const [topic] = await sql`
          SELECT id FROM topics WHERE repo_id = ${repoId} AND LOWER(TRIM(name)) = ${normalizeName(a.targetSpec)}
        `;
        if (topic) {
          await sql`
            INSERT INTO topic_sessions (topic_id, session_id) VALUES (${topic.id}, ${sessionId})
            ON CONFLICT DO NOTHING
          `;
        }
      }
    }

    let commitSha: string | undefined;
    try {
      const { execSync } = await import("node:child_process");
      commitSha = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
    } catch { /* not a git repo */ }
    const versionId = await createBrainVersion(repoId, commitSha);

    // ── Build parent/children maps from plan assignments ─────────────
    const parentBySpec = new Map<string, string>(); // normalized spec name → parent spec name
    const childrenBySpec = new Map<string, string[]>(); // normalized spec name → child spec names
    for (const a of plan.assignments) {
      const norm = normalizeName(a.targetSpec);
      if (a.parentSpec) {
        parentBySpec.set(norm, a.parentSpec);
        const parentNorm = normalizeName(a.parentSpec);
        const siblings = childrenBySpec.get(parentNorm) ?? [];
        if (!siblings.includes(a.targetSpec)) siblings.push(a.targetSpec);
        childrenBySpec.set(parentNorm, siblings);
      }
    }

    // ── Generate and upsert brain cards ──────────────────────────────
    for (const spec of writtenSpecs) {
      const norm = normalizeName(spec.name);
      const parent = parentBySpec.get(norm) ?? null;
      const children = childrenBySpec.get(norm) ?? [];
      const level = parent ? "spec" : "area";

      const card = generateCard({
        name: spec.name,
        level,
        summary: spec.summary,
        insights: spec.insights.map((ins) => ({
          category: ins.category,
          statement: ins.statement,
          confidence: ins.confidence,
        })),
        fileRefs: spec.fileRefs,
        parent,
        children: children.length > 0 ? children : undefined,
        sessions: sessionIds,
        versionId,
      });

      await sql`
        INSERT INTO brain_cards (
          node_name, level, path, parent_node, summary,
          insights, files, exports, related, children,
          sessions, version_id, repo_id
        ) VALUES (
          ${card.name},
          ${card.level},
          ${card.path ?? null},
          ${card.parent ?? null},
          ${card.summary},
          ${JSON.stringify(card.insights)},
          ${JSON.stringify(card.files ?? [])},
          ${JSON.stringify(card.exports ?? [])},
          ${JSON.stringify(card.related ?? [])},
          ${JSON.stringify(card.children ?? [])},
          ${JSON.stringify(card.sessions)},
          ${versionId},
          ${repoId}
        )
        ON CONFLICT (repo_id, node_name) DO UPDATE SET
          level = EXCLUDED.level,
          path = EXCLUDED.path,
          parent_node = EXCLUDED.parent_node,
          summary = EXCLUDED.summary,
          insights = EXCLUDED.insights,
          files = EXCLUDED.files,
          exports = EXCLUDED.exports,
          related = EXCLUDED.related,
          children = EXCLUDED.children,
          sessions = EXCLUDED.sessions,
          version_id = EXCLUDED.version_id
      `;
    }
  }

  return { plan, specs: writtenSpecs };
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
