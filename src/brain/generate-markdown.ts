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

interface PatternRow {
  type: string;
  statement: string;
  frequency: number;
  confidence: string;
}

interface SkillRow {
  name: string;
  description: string;
  steps: string[] | null;
  status: string;
}

interface BrainCardRow {
  node_name: string;
  level: string;
  summary: string;
  parent_node: string | null;
  children: string[] | null;
  insights: { category?: string; statement?: string }[] | null;
  files: { file_path?: string; role?: string }[] | null;
}

// ── Shared: build topic tree + accumulated files ──────────────────

interface TopicNode {
  id: string;
  name: string;
  summary: string;
  parentId: string | null;
  children: TopicNode[];
  ownFiles: string[];          // files directly on this topic
  accumulatedFiles: string[];  // own + all descendants' files
  insightCount: number;
  sessionCount: number;
  card?: BrainCardRow;
}

async function buildTopicTree(repoId: string): Promise<{
  roots: TopicNode[];
  nodeByName: Map<string, TopicNode>;
  nodeById: Map<string, TopicNode>;
}> {
  const sql = getClient();

  const topics = await sql`
    SELECT t.id, t.name, t.summary,
      (SELECT count(*)::int FROM insights i WHERE i.topic_id = t.id AND i.status = 'active') as insight_count,
      (SELECT count(DISTINCT ts.session_id)::int FROM topic_sessions ts WHERE ts.topic_id = t.id) as session_count
    FROM topics t WHERE t.repo_id = ${repoId} ORDER BY t.name
  ` as any[];

  const cards = await sql`
    SELECT node_name, level, summary, parent_node, children, insights, files
    FROM brain_cards WHERE repo_id = ${repoId}
  ` as BrainCardRow[];
  const cardByName = new Map<string, BrainCardRow>();
  for (const c of cards) cardByName.set(c.node_name, c);

  // Build nodes
  const nodeById = new Map<string, TopicNode>();
  const nodeByName = new Map<string, TopicNode>();
  for (const t of topics) {
    const fileRows = await sql`
      SELECT DISTINCT file_path FROM topic_files WHERE topic_id = ${t.id} ORDER BY file_path
    `;
    const node: TopicNode = {
      id: t.id,
      name: t.name,
      summary: t.summary,
      parentId: null, // parent_topic_id retired (PRD v0.3) — flat topic list
      children: [],
      ownFiles: fileRows.map((f: any) => f.file_path),
      accumulatedFiles: [],
      insightCount: Number(t.insight_count),
      sessionCount: Number(t.session_count),
      card: cardByName.get(t.name),
    };
    nodeById.set(t.id, node);
    nodeByName.set(t.name, node);
  }

  // Link children
  const roots: TopicNode[] = [];
  for (const node of nodeById.values()) {
    if (node.parentId && nodeById.has(node.parentId)) {
      nodeById.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Accumulate files bottom-up (DFS post-order)
  function accumulateFiles(node: TopicNode): string[] {
    const fileSet = new Set(node.ownFiles);
    for (const child of node.children) {
      for (const f of accumulateFiles(child)) {
        fileSet.add(f);
      }
    }
    node.accumulatedFiles = [...fileSet].sort();
    return node.accumulatedFiles;
  }
  for (const root of roots) accumulateFiles(root);

  return { roots, nodeByName, nodeById };
}

/**
 * Generate .repo/brain.md — LLM-friendly project knowledge index.
 */
export async function generateBrainMarkdown(repoId: string): Promise<string> {
  const sql = getClient();

  const [project] = await sql`SELECT name FROM projects WHERE id = ${repoId}`;
  if (!project) throw new Error(`Project ${repoId} not found`);

  const { roots } = await buildTopicTree(repoId);

  let md = `# ${project.name} — Brain\n\n`;
  md += `> This file is the entry point to the project's knowledge graph.\n`;
  md += `> Each spec below is a concept in the codebase with accumulated insights from development sessions.\n`;
  md += `> Use the file index at the bottom to find which spec covers any source file.\n\n`;

  // Render tree
  function renderNode(node: TopicNode, depth: number): string {
    const indent = "  ".repeat(depth);
    const link = `[${node.name}](topics/${slugify(node.name)}.md)`;
    const fileSummary = node.accumulatedFiles.length > 0
      ? ` (${node.accumulatedFiles.length} files)`
      : "";
    let out = `${indent}- ${link} — ${truncate(node.summary, 100)}${fileSummary}\n`;
    for (const child of node.children) {
      out += renderNode(child, depth + 1);
    }
    return out;
  }

  for (const root of roots) {
    md += `## ${root.name}\n\n`;
    md += renderNode(root, 0);
    md += "\n";
  }

  // File index: file → spec path (most specific spec that owns it)
  const fileToSpec = new Map<string, string>();
  function indexFiles(node: TopicNode, path: string) {
    // Children are more specific — they override parent for shared files
    for (const f of node.ownFiles) {
      fileToSpec.set(f, path);
    }
    for (const child of node.children) {
      indexFiles(child, `${path} > ${child.name}`);
    }
  }
  for (const root of roots) indexFiles(root, root.name);

  if (fileToSpec.size > 0) {
    md += `## File Index\n\n`;
    md += `> Find which spec covers a source file. Path shows the spec hierarchy.\n\n`;
    md += `| File | Spec |\n|------|------|\n`;
    const sorted = [...fileToSpec.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [file, specPath] of sorted) {
      md += `| \`${toRelativePath(file)}\` | ${specPath} |\n`;
    }
  }

  return md;
}

/**
 * Generate .repo/topics/<name>.md — LLM-friendly spec document.
 */
export async function generateTopicMarkdown(topicId: string): Promise<{ slug: string; content: string }> {
  const sql = getClient();

  const [topic] = await sql`SELECT id, name, summary, repo_id FROM topics WHERE id = ${topicId}` as any[];
  if (!topic) throw new Error(`Topic ${topicId} not found`);

  const { nodeByName } = await buildTopicTree(topic.repo_id);
  const node = nodeByName.get(topic.name);


  const insights = await sql`
    SELECT category, statement, confidence FROM insights
    WHERE topic_id = ${topicId} AND status = 'active'
    ORDER BY category, confidence DESC
  ` as InsightRow[];

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

  const patterns = await sql`
    SELECT type, statement, frequency, confidence
    FROM topic_patterns
    WHERE topic_id = ${topicId}
    ORDER BY frequency DESC, confidence DESC
  ` as PatternRow[];

  const skills = await sql`
    SELECT name, description, steps, status
    FROM topic_skills
    WHERE topic_id = ${topicId} AND status IN ('approved', 'validated')
    ORDER BY name
  ` as SkillRow[];

  // ── Build LLM-friendly markdown ──

  let md = `# ${topic.name}\n\n`;

  // Navigation breadcrumb (parent_topic_id retired — topics are flat)
  if (node && node.children.length > 0) {
    const childLinks = node.children.map(c => `[${c.name}](${slugify(c.name)}.md)`).join(", ");
    md += `> Children: ${childLinks}\n\n`;
  }

  // Summary
  md += `${topic.summary}\n`;

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

  // Patterns
  if (patterns.length > 0) {
    const patternIcon: Record<string, string> = {
      request: "?",
      struggle: "!",
      file_access: "~",
    };
    md += `\n## Patterns\n\n`;
    for (const p of patterns) {
      const icon = patternIcon[p.type] ?? "-";
      md += `- ${icon} **${p.type}**: ${p.statement} (${p.frequency} sessions, ${p.confidence})\n`;
    }
  }

  // Skills
  if (skills.length > 0) {
    md += `\n## Skills\n`;
    for (const s of skills) {
      md += `\n### ${s.name}\n\n`;
      if (s.description) md += `${s.description}\n\n`;
      const steps: string[] = Array.isArray(s.steps) ? s.steps : [];
      for (let i = 0; i < steps.length; i++) {
        md += `${i + 1}. ${steps[i]}\n`;
      }
    }
  }

  // Accumulated files (own + children's)
  if (node && node.accumulatedFiles.length > 0) {
    const ownSet = new Set(node.ownFiles);
    md += `\n## Files\n\n`;

    // Own files first
    const ownFiles = node.accumulatedFiles.filter(f => ownSet.has(f));
    if (ownFiles.length > 0) {
      for (const f of ownFiles) {
        md += `- \`${toRelativePath(f)}\`\n`;
      }
    }

    // Inherited files (from children), grouped by child
    for (const child of node.children) {
      const childFiles = child.accumulatedFiles.filter(f => !ownSet.has(f));
      if (childFiles.length > 0) {
        md += `- _from [${child.name}](${slugify(child.name)}.md):_\n`;
        for (const f of childFiles) {
          md += `  - \`${toRelativePath(f)}\`\n`;
        }
      }
    }
  }

  // Evidence sessions
  if (sessionRows.length > 0) {
    md += `\n## Sessions\n\n`;
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
