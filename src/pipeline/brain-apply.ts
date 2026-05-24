import { getClient } from "../storage/connection.js";
import type { GraphPlan } from "../llm/prompts/brain-organize.js";
import type { WrittenSpec } from "../llm/prompts/brain-write.js";
import { findDuplicateIndices, computeSimilarity } from "./dedup.js";

// ── Helpers (exported for testing) ──────────────────────────────────

/** Lowercase + trim for case-insensitive topic matching. */
export function normalizeName(name: string): string {
  return name.toLowerCase().trim();
}

/**
 * Build a parent map from a GraphPlan.
 * Returns Map<normalizedChildName, normalizedParentName>.
 */
export function buildParentMap(plan: GraphPlan): Map<string, string> {
  const parents = new Map<string, string>();

  for (const a of plan.assignments) {
    if (a.parentSpec) {
      parents.set(normalizeName(a.targetSpec), normalizeName(a.parentSpec));
    }
  }

  for (const m of plan.merges) {
    if (m.parentSpec) {
      parents.set(normalizeName(m.intoName), normalizeName(m.parentSpec));
    }
  }

  for (const s of plan.splits) {
    const parent = s.parentSpec ? normalizeName(s.parentSpec) : normalizeName(s.spec);
    for (const into of s.into) {
      // Split children get parentSpec if provided, otherwise the original spec acts as parent
      if (s.parentSpec) {
        parents.set(normalizeName(into.name), normalizeName(s.parentSpec));
      }
    }
  }

  return parents;
}

/**
 * Detect cycles in a parent map. Throws if any cycle is found.
 */
export function detectCycles(parentMap: Map<string, string>): void {
  for (const [start] of parentMap) {
    const visited = new Set<string>();
    let current: string | undefined = start;

    while (current !== undefined) {
      if (visited.has(current)) {
        throw new Error(`Circular parent reference detected: ${[...visited, current].join(" → ")}`);
      }
      visited.add(current);
      current = parentMap.get(current);
    }
  }
}

// ── Main function ───────────────────────────────────────────────────

/**
 * Apply a GraphPlan to the database. Purely deterministic — no LLM calls.
 *
 * Execution order:
 * 1. Validate (cycle detection)
 * 2. Merge — combine topics, move insights/evidence/files, delete absorbed
 * 3. Split — create new topics, reassign insights, delete original
 * 4. Create — insert new topics from assignments with action="create"
 * 5. Update — update existing topics from assignments with action="update"
 */
export async function applyGraphPlan(
  repoId: string,
  sessionId: string,
  plan: GraphPlan,
  writtenSpecs: WrittenSpec[],
  momentIdMap: Map<string, string>,
): Promise<void> {
  const sql = getClient();

  // Build a lookup from normalized spec name → WrittenSpec
  const specByName = new Map<string, WrittenSpec>();
  for (const spec of writtenSpecs) {
    specByName.set(normalizeName(spec.name), spec);
  }

  // ── 1. Validate ──────────────────────────────────────────────────
  const parentMap = buildParentMap(plan);
  detectCycles(parentMap);

  // ── 2. Merge ─────────────────────────────────────────────────────
  for (const merge of plan.merges) {
    const targetName = merge.intoName;
    const targetNorm = normalizeName(targetName);

    // Find or create the target topic
    let targetId = await findTopicId(sql, repoId, targetName);
    if (!targetId) {
      const spec = specByName.get(targetNorm);
      const [inserted] = await sql`
        INSERT INTO topics (repo_id, name, summary)
        VALUES (${repoId}, ${targetName}, ${spec?.summary || ""})
        RETURNING id
      `;
      targetId = inserted.id;
    }

    // Set parent if specified
    if (merge.parentSpec) {
      const parentId = await findTopicId(sql, repoId, merge.parentSpec);
      if (parentId) {
        await sql`UPDATE topics SET parent_topic_id = ${parentId} WHERE id = ${targetId}`;
      }
    }

    // Move insights, evidence, files, sessions from absorbed topics to target
    for (const specName of merge.specs) {
      if (normalizeName(specName) === targetNorm) continue; // skip self

      const absorbedId = await findTopicId(sql, repoId, specName);
      if (!absorbedId) continue;

      // Move insights to target topic
      await sql`UPDATE insights SET topic_id = ${targetId} WHERE topic_id = ${absorbedId}`;
      // Move file refs
      await sql`UPDATE topic_files SET topic_id = ${targetId} WHERE topic_id = ${absorbedId}`;
      // Move session links
      await sql`
        INSERT INTO topic_sessions (topic_id, session_id)
        SELECT ${targetId}, session_id FROM topic_sessions WHERE topic_id = ${absorbedId}
        ON CONFLICT DO NOTHING
      `;

      // Delete absorbed topic (cascades session links for absorbed)
      await sql`DELETE FROM topics WHERE id = ${absorbedId}`;
    }

    // Deduplicate insights on target: identical statements → keep highest confidence
    await deduplicateInsights(sql, targetId!);

    // Apply written spec content if available
    const spec = specByName.get(targetNorm);
    if (spec && targetId) {
      await sql`UPDATE topics SET summary = ${spec.summary}, updated_at = NOW() WHERE id = ${targetId}`;
      await storeSpecContent(sql, targetId, sessionId, spec, momentIdMap);
    }

    // Link to session
    if (targetId) {
      await sql`
        INSERT INTO topic_sessions (topic_id, session_id) VALUES (${targetId}, ${sessionId})
        ON CONFLICT DO NOTHING
      `;
    }
  }

  // ── 3. Split ─────────────────────────────────────────────────────
  for (const split of plan.splits) {
    const originalId = await findTopicId(sql, repoId, split.spec);

    for (const into of split.into) {
      const intoNorm = normalizeName(into.name);
      const spec = specByName.get(intoNorm);

      // Create new topic
      const parentId = split.parentSpec
        ? await findTopicId(sql, repoId, split.parentSpec)
        : null;

      const [newTopic] = await sql`
        INSERT INTO topics (repo_id, name, summary, parent_topic_id)
        VALUES (${repoId}, ${into.name}, ${spec?.summary || ""}, ${parentId})
        RETURNING id
      `;

      // Reassign insights by ID list from original topic
      if (originalId && into.insightIds.length > 0) {
        await sql`
          UPDATE insights SET topic_id = ${newTopic.id}
          WHERE topic_id = ${originalId} AND id = ANY(${into.insightIds}::uuid[])
        `;
      }

      // Apply written spec content
      if (spec) {
        await storeSpecContent(sql, newTopic.id, sessionId, spec, momentIdMap);
      }

      // Link to session
      await sql`
        INSERT INTO topic_sessions (topic_id, session_id) VALUES (${newTopic.id}, ${sessionId})
        ON CONFLICT DO NOTHING
      `;
    }

    // Delete the original topic after splitting
    if (originalId) {
      await sql`DELETE FROM topics WHERE id = ${originalId}`;
    }
  }

  // ── 4. Create ────────────────────────────────────────────────────
  const createAssignments = plan.assignments.filter((a) => a.action === "create");
  // Group by target spec to avoid duplicate creates
  const createTargets = new Map<string, typeof createAssignments[0]>();
  for (const a of createAssignments) {
    const norm = normalizeName(a.targetSpec);
    if (!createTargets.has(norm)) {
      createTargets.set(norm, a);
    }
  }

  for (const [norm, assignment] of createTargets) {
    // Skip if topic already exists (may have been created by merge/split)
    const existing = await findTopicId(sql, repoId, assignment.targetSpec);
    if (existing) continue;

    const spec = specByName.get(norm);
    const parentId = assignment.parentSpec
      ? await findTopicId(sql, repoId, assignment.parentSpec)
      : null;

    const [inserted] = await sql`
      INSERT INTO topics (repo_id, name, summary, parent_topic_id)
      VALUES (${repoId}, ${assignment.targetSpec}, ${spec?.summary || ""}, ${parentId})
      RETURNING id
    `;

    if (spec) {
      await storeSpecContent(sql, inserted.id, sessionId, spec, momentIdMap);
    }

    await sql`
      INSERT INTO topic_sessions (topic_id, session_id) VALUES (${inserted.id}, ${sessionId})
      ON CONFLICT DO NOTHING
    `;
  }

  // ── 5. Update ────────────────────────────────────────────────────
  const updateAssignments = plan.assignments.filter((a) => a.action === "update");
  // Group by target spec to avoid duplicate updates
  const updateTargets = new Set<string>();
  for (const a of updateAssignments) {
    updateTargets.add(normalizeName(a.targetSpec));
  }

  for (const norm of updateTargets) {
    // Find the original assignment to get the spec name
    const assignment = updateAssignments.find((a) => normalizeName(a.targetSpec) === norm)!;
    const topicId = await findTopicId(sql, repoId, assignment.targetSpec);
    if (!topicId) continue;

    const spec = specByName.get(norm);
    if (spec) {
      await sql`UPDATE topics SET summary = ${spec.summary}, updated_at = NOW() WHERE id = ${topicId}`;
      await storeSpecContent(sql, topicId, sessionId, spec, momentIdMap);
    }

    await sql`
      INSERT INTO topic_sessions (topic_id, session_id) VALUES (${topicId}, ${sessionId})
      ON CONFLICT DO NOTHING
    `;
  }
}

// ── Internal helpers ────────────────────────────────────────────────

/** Find a topic ID by name (case-insensitive). */
async function findTopicId(
  sql: ReturnType<typeof getClient>,
  repoId: string,
  name: string,
): Promise<string | null> {
  const [row] = await sql`
    SELECT id FROM topics WHERE repo_id = ${repoId} AND LOWER(TRIM(name)) = ${normalizeName(name)}
  `;
  return row?.id || null;
}

/** Store insights, evidence, and file refs from a WrittenSpec. */
async function storeSpecContent(
  sql: ReturnType<typeof getClient>,
  topicId: string,
  sessionId: string,
  spec: WrittenSpec,
  momentIdMap: Map<string, string>,
): Promise<void> {
  // Filter near-duplicate insights within the incoming batch before storing
  const batchDupes = findDuplicateIndices(
    spec.insights.map((i) => ({ statement: i.statement, confidence: i.confidence })),
  );
  const filteredInsights = spec.insights.filter((_, idx) => !batchDupes.has(idx));

  // Upsert insights (deduplicate by statement against existing DB rows)
  for (const insight of filteredInsights) {
    // Fetch all existing insights for this topic to check near-duplicates
    const existingRows = await sql<{ id: string; statement: string; confidence: number }[]>`
      SELECT id, statement, confidence FROM insights WHERE topic_id = ${topicId}
    `;

    // Find an existing insight that is a near-duplicate of the incoming one
    const nearDupe = existingRows.find(
      (row) => computeSimilarity(row.statement, insight.statement) >= 0.7,
    );

    let insightId: string;
    if (nearDupe) {
      // Update confidence if new is higher
      await sql`
        UPDATE insights SET confidence = GREATEST(confidence, ${insight.confidence})
        WHERE id = ${nearDupe.id}
      `;
      insightId = nearDupe.id;
    } else {
      const [ins] = await sql`
        INSERT INTO insights (topic_id, category, statement, confidence, status)
        VALUES (${topicId}, ${insight.category}, ${insight.statement}, ${insight.confidence}, 'active')
        RETURNING id
      `;
      insightId = ins.id;
    }

    // Store evidence refs
    for (const ev of insight.evidence) {
      const evMomentId = (ev as any).momentId as string | undefined;
      const momentUuid = evMomentId ? (momentIdMap.get(evMomentId) || null) : null;
      await sql`
        INSERT INTO insight_evidence (insight_id, session_id, moment_id, reasoning)
        VALUES (${insightId}, ${sessionId}, ${momentUuid}, ${ev.reasoning || null})
      `;
    }
  }

  // Store file refs
  for (const f of spec.fileRefs) {
    await sql`
      INSERT INTO topic_files (topic_id, file_path, role, session_id)
      VALUES (${topicId}, ${f.path}, ${f.role}, ${sessionId})
    `;
  }
}

/** Deduplicate insights on a topic: near-duplicate statements → keep highest confidence, merge evidence. */
async function deduplicateInsights(
  sql: ReturnType<typeof getClient>,
  topicId: string,
): Promise<void> {
  // Fetch all insights for the topic
  const rows = await sql<{ id: string; statement: string; confidence: number }[]>`
    SELECT id, statement, confidence FROM insights WHERE topic_id = ${topicId}
  `;

  if (rows.length === 0) return;

  // Find near-duplicate indices using similarity scoring
  const dupeIndices = findDuplicateIndices(
    rows.map((r) => ({ statement: r.statement, confidence: r.confidence })),
  );

  if (dupeIndices.size === 0) return;

  // For each duplicate, find the keeper (the one with highest confidence that it was merged into)
  // We need to map: removeId → keepId
  // Re-run pairwise to find which keeper each duplicate corresponds to
  const removeToKeep = new Map<string, string>();
  for (const removeIdx of dupeIndices) {
    const removeRow = rows[removeIdx];
    // Find the non-removed row most similar to this one
    for (let i = 0; i < rows.length; i++) {
      if (dupeIndices.has(i)) continue; // keeper must not be removed
      if (computeSimilarity(rows[i].statement, removeRow.statement) >= 0.7) {
        // Keep the one with higher confidence
        const keeper = rows[i].confidence >= removeRow.confidence ? rows[i] : removeRow;
        const removed = keeper.id === rows[i].id ? removeRow : rows[i];
        removeToKeep.set(removed.id, keeper.id);
        break;
      }
    }
    // Fallback: if no keeper found (edge case), skip this duplicate
    if (!removeToKeep.has(removeRow.id)) {
      removeToKeep.set(removeRow.id, rows[removeIdx === 0 ? 1 : 0].id);
    }
  }

  // Merge evidence and delete duplicate rows
  for (const [removeId, keepId] of removeToKeep) {
    await sql`
      UPDATE insight_evidence SET insight_id = ${keepId} WHERE insight_id = ${removeId}
    `;
    await sql`DELETE FROM insights WHERE id = ${removeId}`;
  }
}
