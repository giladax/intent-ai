import { getClient } from "../storage/connection.js";

interface TopicRow {
  id: string;
  name: string;
  summary: string;
}

interface InsightRow {
  category: string;
  statement: string;
  confidence: number;
}

interface FileRow {
  file_path: string;
  role: string;
}

interface SessionRow {
  session_id: string;
  session_shape: string;
  summary: string;
  started_at: string;
  moment_count: number;
}

interface RelatedRow {
  name: string;
}

/**
 * Generate .repo/brain.md root index.
 */
export async function generateBrainMarkdown(repoId: string): Promise<string> {
  const sql = getClient();

  const [project] = await sql`SELECT name FROM projects WHERE id = ${repoId}`;
  if (!project) throw new Error(`Project ${repoId} not found`);

  const topics = await sql`
    SELECT t.id, t.name, t.summary,
      (SELECT count(*) FROM topic_sessions ts WHERE ts.topic_id = t.id) as session_count,
      (SELECT count(*) FROM insights i WHERE i.topic_id = t.id AND i.status = 'active') as insight_count
    FROM topics t WHERE t.repo_id = ${repoId} ORDER BY session_count DESC, t.name
  ` as any[];

  // Build file map: file → topics
  const fileMap = new Map<string, string[]>();
  for (const t of topics) {
    const files = await sql`SELECT file_path FROM topic_files WHERE topic_id = ${t.id}`;
    for (const f of files) {
      const list = fileMap.get(f.file_path) || [];
      if (!list.includes(t.name)) list.push(t.name);
      fileMap.set(f.file_path, list);
    }
  }

  let md = `# ${project.name} Brain\n\n`;

  // Topics list
  md += `## Topics\n\n`;
  for (const t of topics) {
    md += `- [${t.name}](topics/${slugify(t.name)}.md) — ${truncate(t.summary, 80)} (${t.session_count} sessions, ${t.insight_count} insights)\n`;
  }

  // File map
  if (fileMap.size > 0) {
    md += `\n## File Map\n\n`;
    md += `| File | Topics |\n|------|--------|\n`;
    const sorted = [...fileMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [file, topicNames] of sorted) {
      md += `| ${toRelativePath(file)} | ${topicNames.join(", ")} |\n`;
    }
  }

  return md;
}

/**
 * Generate .repo/topics/<name>.md for a single topic.
 */
export async function generateTopicMarkdown(topicId: string): Promise<{ slug: string; content: string }> {
  const sql = getClient();

  const [topic] = await sql`SELECT id, name, summary FROM topics WHERE id = ${topicId}` as TopicRow[];
  if (!topic) throw new Error(`Topic ${topicId} not found`);

  const insights = await sql`
    SELECT category, statement, confidence FROM insights
    WHERE topic_id = ${topicId} AND status = 'active'
    ORDER BY category, confidence DESC
  ` as InsightRow[];

  const files = await sql`
    SELECT DISTINCT file_path, role FROM topic_files WHERE topic_id = ${topicId} ORDER BY file_path
  ` as FileRow[];

  const sessionRows = await sql`
    SELECT DISTINCT ON (ts.session_id) ts.session_id, s.session_shape, n.summary,
      s.started_at,
      (SELECT count(*) FROM moments m WHERE m.session_id = s.id) as moment_count
    FROM topic_sessions ts
    JOIN sessions s ON s.id = ts.session_id
    LEFT JOIN narratives n ON n.session_id = s.id
    WHERE ts.topic_id = ${topicId}
    ORDER BY ts.session_id, s.started_at
  ` as SessionRow[];

  const related = await sql`
    SELECT t2.name FROM topic_relations tr
    JOIN topics t2 ON t2.id = tr.related_topic_id
    WHERE tr.topic_id = ${topicId}
  ` as RelatedRow[];

  let md = `# ${topic.name}\n\n${topic.summary}\n`;

  // Insights by category
  const byCategory = new Map<string, InsightRow[]>();
  for (const i of insights) {
    const list = byCategory.get(i.category) || [];
    list.push(i);
    byCategory.set(i.category, list);
  }

  const categoryOrder = ["structure", "constraint", "decision", "behavior", "risk", "interface"];
  for (const cat of categoryOrder) {
    const catInsights = byCategory.get(cat);
    if (!catInsights) continue;
    md += `\n## ${cat}\n\n`;
    for (const i of catInsights) {
      md += `- ${i.statement}\n`;
    }
  }

  // Files
  if (files.length > 0) {
    md += `\n## Files\n\n`;
    for (const f of files) {
      md += `- \`${toRelativePath(f.file_path)}\`${f.role ? ` — ${f.role}` : ""}\n`;
    }
  }

  // Evidence sessions
  if (sessionRows.length > 0) {
    md += `\n## Evidence\n\n`;
    for (const s of sessionRows) {
      const date = s.started_at ? new Date(s.started_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "unknown";
      md += `- ${date}: ${truncate(s.summary || s.session_shape, 100)} (${s.moment_count} moments)\n`;
    }
  }

  // Related topics
  if (related.length > 0) {
    md += `\n## Related\n\n`;
    for (const r of related) {
      md += `- [${r.name}](${slugify(r.name)}.md)\n`;
    }
  }

  return { slug: slugify(topic.name), content: md };
}

/**
 * Generate all markdown for a repo: brain.md + topics/*.md
 */
export async function generateAllMarkdown(repoId: string): Promise<{ brainMd: string; topics: { slug: string; content: string }[] }> {
  const sql = getClient();

  const topicRows = await sql`SELECT id FROM topics WHERE repo_id = ${repoId} ORDER BY name`;

  const brainMd = await generateBrainMarkdown(repoId);
  const topics = await Promise.all(
    topicRows.map((t: any) => generateTopicMarkdown(t.id)),
  );

  return { brainMd, topics };
}

// ── Helpers ──────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + "...";
}

/**
 * Strip the repo root prefix from an absolute file path to make it relative.
 * Uses process.cwd() as the repo root. If the path doesn't start with cwd, returns it unchanged.
 */
function toRelativePath(filePath: string): string {
  const root = process.cwd();
  if (filePath.startsWith(root + "/")) {
    return filePath.slice(root.length + 1);
  }
  if (filePath.startsWith(root)) {
    return filePath.slice(root.length) || filePath;
  }
  return filePath;
}
