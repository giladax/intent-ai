import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join, resolve } from "path";

// ── Graph model ───────────────────────────────────────────────────
//
// The brain is a multi-dimensional knowledge graph:
//
//   Topics (tree via parent) ←→ TopicRelations (cross-links)
//     ├── Insights (by category: structure/decision/constraint/behavior/risk/interface)
//     ├── Files (with roles)
//     └── Sessions (evidence trail)
//
// Agents traverse this graph through three prisms:
//   file   → "what specs cover this code?"
//   spec   → "what does this area know? what's related?"
//   session → "what was learned in this session?"

// ── Types ─────────────────────────────────────────────────────────

export interface TopicNode {
  name: string;
  slug: string;
  summary: string;
  parent: string | null;
  children: string[];
  related: string[];
  insights: { category: string; statement: string }[];
  files: string[];
  sessions: { date: string; summary: string; moments: number }[];
  fullMarkdown: string;
}

interface BrainGraph {
  topics: Map<string, TopicNode>;
  fileIndex: Map<string, string[]>; // file → topic names (multiple possible)
  slugToName: Map<string, string>;
}

// ── Loader ────────────────────────────────────────────────────────

function findRepoDir(): string {
  let dir = process.cwd();
  while (dir !== "/") {
    if (existsSync(join(dir, ".repo", "brain.md"))) return join(dir, ".repo");
    dir = resolve(dir, "..");
  }
  throw new Error("No .repo/ directory found. Run `intent brain-export` first.");
}

export function parseTopic(slug: string, content: string): TopicNode {
  const lines = content.split("\n");

  // Name from first heading
  const name = lines[0]?.replace(/^#\s+/, "").trim() || slug;

  // Parent from breadcrumb
  const parentMatch = content.match(/^>\s*Parent:\s*\[(.+?)\]/m);
  const parent = parentMatch?.[1] || null;

  // Children from breadcrumb
  const childrenMatch = content.match(/^>\s*Children:\s*(.+)$/m);
  const children: string[] = [];
  if (childrenMatch) {
    for (const m of childrenMatch[1].matchAll(/\[(.+?)\]/g)) {
      children.push(m[1]);
    }
  }

  // Related from ## Related section
  const related: string[] = [];
  const relatedSection = content.match(/## Related\n\n([\s\S]*?)(?=\n##|$)/);
  if (relatedSection) {
    for (const m of relatedSection[1].matchAll(/\[(.+?)\]/g)) {
      related.push(m[1]);
    }
  }

  // Summary: first non-heading, non-breadcrumb paragraph
  const summaryLines: string[] = [];
  let inSummary = false;
  for (const line of lines.slice(1)) {
    if (line.startsWith(">")) continue;
    if (line.startsWith("## ")) break;
    if (line.trim() === "" && !inSummary) continue;
    if (line.trim() === "" && inSummary) break;
    inSummary = true;
    summaryLines.push(line);
  }
  const summary = summaryLines.join(" ").trim();

  // Insights by category
  const insights: { category: string; statement: string }[] = [];
  const categories = ["structure", "constraint", "decision", "behavior", "risk", "interface"];
  for (const cat of categories) {
    const catRegex = new RegExp(`## ${cat}\\n\\n([\\s\\S]*?)(?=\\n## |$)`, "i");
    const catMatch = content.match(catRegex);
    if (catMatch) {
      for (const line of catMatch[1].split("\n")) {
        const m = line.match(/^- (.+)/);
        if (m) insights.push({ category: cat, statement: m[1] });
      }
    }
  }

  // Files from ## Files section
  const files: string[] = [];
  const filesSection = content.match(/## Files\n\n([\s\S]*?)(?=\n## |$)/);
  if (filesSection) {
    for (const m of filesSection[1].matchAll(/`([^`]+)`/g)) {
      files.push(m[1]);
    }
  }

  // Sessions from ## Sessions section
  const sessions: { date: string; summary: string; moments: number }[] = [];
  const sessionsSection = content.match(/## Sessions\n\n([\s\S]*?)(?=\n## |$)/);
  if (sessionsSection) {
    for (const line of sessionsSection[1].split("\n")) {
      const m = line.match(/^- (.+?):\s+(.+?)\s+\((\d+) moments\)$/);
      if (m) sessions.push({ date: m[1], summary: m[2], moments: parseInt(m[3]) });
    }
  }

  return {
    name, slug, summary, parent, children, related,
    insights, files, sessions, fullMarkdown: content,
  };
}

function loadBrainGraph(repoDir: string): BrainGraph {
  const topics = new Map<string, TopicNode>();
  const slugToName = new Map<string, string>();
  const fileIndex = new Map<string, string[]>();

  const topicsDir = join(repoDir, "topics");
  if (existsSync(topicsDir)) {
    for (const file of readdirSync(topicsDir)) {
      if (!file.endsWith(".md")) continue;
      const slug = file.replace(/\.md$/, "");
      const content = readFileSync(join(topicsDir, file), "utf-8");
      const node = parseTopic(slug, content);
      topics.set(node.name, node);
      slugToName.set(slug, node.name);
    }
  }

  // Build file → topics index
  for (const node of topics.values()) {
    for (const f of node.files) {
      const existing = fileIndex.get(f) || [];
      existing.push(node.name);
      fileIndex.set(f, existing);
    }
  }

  return { topics, fileIndex, slugToName };
}

// ── Search scoring ────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

export function fuzzyScore(query: string, text: string): number {
  const qTokens = tokenize(query);
  const tTokens = new Set(tokenize(text));
  if (qTokens.length === 0) return 0;

  // Exact substring match is strongest
  if (text.toLowerCase().includes(query.toLowerCase())) return 1.0;

  // Token overlap with partial matching
  let hits = 0;
  for (const q of qTokens) {
    if (tTokens.has(q)) { hits += 1; continue; }
    // Partial: any target token starts with or contains query token
    for (const t of tTokens) {
      if (t.includes(q) || q.includes(t)) { hits += 0.5; break; }
    }
  }
  return hits / qTokens.length;
}

// ── Card format (compact overview for LLM navigation) ─────────

export function formatCard(node: TopicNode): string {
  const lines: string[] = [];

  // Header with hierarchy indicator
  if (node.parent) {
    lines.push(`### ${node.name}  ↑ ${node.parent}`);
  } else {
    lines.push(`### ${node.name}`);
  }

  // Summary (first 200 chars)
  lines.push(node.summary.slice(0, 200));

  // Top insights: one per distinct category, max 3
  const seenCats = new Set<string>();
  const topInsights = node.insights.filter((i) => {
    if (seenCats.has(i.category)) return false;
    seenCats.add(i.category);
    return true;
  }).slice(0, 3);

  if (topInsights.length > 0) {
    lines.push("");
    for (const i of topInsights) {
      lines.push(`- [${i.category}] ${i.statement.slice(0, 150)}`);
    }
  }

  // Navigation hints
  const nav: string[] = [];
  if (node.children.length > 0) nav.push(`${node.children.length} sub-specs: ${node.children.join(", ")}`);
  if (node.related.length > 0) nav.push(`related: ${node.related.join(", ")}`);
  if (node.files.length > 0) nav.push(`${node.files.length} files`);
  if (node.sessions.length > 0) nav.push(`${node.sessions.length} sessions`);

  if (nav.length > 0) {
    lines.push("");
    lines.push(`_${nav.join(" · ")}_`);
  }

  return lines.join("\n");
}

// ── MCP Server ────────────────────────────────────────────────────

export function createBrainServer(): McpServer {
  const server = new McpServer({
    name: "intent-brain",
    version: "1.0.0",
  });

  let graph: BrainGraph | null = null;
  function getGraph(): BrainGraph {
    if (!graph) graph = loadBrainGraph(findRepoDir());
    return graph;
  }

  // ── brain_overview ────────────────────────────────────────────
  // Entry point: compact tree with one-line summaries.
  // Agent reads this first to orient, then drills in.

  server.tool(
    "brain_overview",
    "Get top-level knowledge areas as cards — start here, then drill into any area",
    {},
    async () => {
      const { topics } = getGraph();
      const roots = [...topics.values()].filter((t) => !t.parent);

      // Sort by insight count descending (most knowledge-rich first)
      roots.sort((a, b) => b.insights.length - a.insights.length);

      const cards = roots.map((r) => formatCard(r));

      let text = `# Brain — ${roots.length} Top-Level Areas\n\n`;
      text += cards.join("\n\n---\n\n");
      text += `\n\n---\n_${topics.size} specs total. Use brain_get(name) to expand, brain_traverse(name) for neighbors._`;

      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── brain_search ──────────────────────────────────────────────
  // Fuzzy search across all dimensions: names, summaries, insights, files.
  // Returns compact cards so agent can decide where to drill.

  server.tool(
    "brain_search",
    "Search the knowledge graph across topics, insights, and files. Returns compact cards for navigation.",
    {
      query: z.string().describe("Search query — concepts, file paths, technical terms"),
      prism: z.enum(["all", "specs", "files", "insights"]).default("all")
        .describe("Focus search on a specific dimension"),
    },
    async ({ query, prism }) => {
      const { topics, fileIndex } = getGraph();

      type Result = { name: string; score: number; via: string };
      const results: Result[] = [];

      for (const node of topics.values()) {
        let bestScore = 0;
        let via = "name";

        if (prism === "all" || prism === "specs") {
          const nameScore = fuzzyScore(query, node.name) * 2.0;
          const summaryScore = fuzzyScore(query, node.summary) * 1.2;
          if (nameScore > bestScore) { bestScore = nameScore; via = "name"; }
          if (summaryScore > bestScore) { bestScore = summaryScore; via = "summary"; }
        }

        if (prism === "all" || prism === "insights") {
          for (const ins of node.insights) {
            const s = fuzzyScore(query, ins.statement) * 1.0;
            if (s > bestScore) { bestScore = s; via = `insight [${ins.category}]`; }
          }
        }

        if (prism === "all" || prism === "files") {
          for (const f of node.files) {
            const s = fuzzyScore(query, f) * 1.5;
            if (s > bestScore) { bestScore = s; via = `file: ${f}`; }
          }
        }

        if (bestScore > 0.3) results.push({ name: node.name, score: bestScore, via });
      }

      // File prism: also check fileIndex directly for partial path matches
      if (prism === "all" || prism === "files") {
        for (const [filePath, topicNames] of fileIndex) {
          const s = fuzzyScore(query, filePath);
          if (s > 0.3) {
            for (const name of topicNames) {
              if (!results.find((r) => r.name === name && r.via.startsWith("file"))) {
                results.push({ name, score: s * 1.5, via: `file: ${filePath}` });
              }
            }
          }
        }
      }

      // Deduplicate, keep best score per topic
      const best = new Map<string, Result>();
      for (const r of results) {
        const existing = best.get(r.name);
        if (!existing || r.score > existing.score) best.set(r.name, r);
      }

      const sorted = [...best.values()].sort((a, b) => b.score - a.score).slice(0, 8);

      if (sorted.length === 0) {
        return { content: [{ type: "text" as const, text: `No results for "${query}". Try brain_overview to see all topics.` }] };
      }

      const text = sorted.map((r) => {
        const node = topics.get(r.name)!;
        return `${formatCard(node)}\n_matched via: ${r.via} (${(r.score * 100).toFixed(0)}%)_`;
      }).join("\n\n---\n\n");

      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── brain_get ─────────────────────────────────────────────────
  // Full spec: all insights, files, sessions, evidence trail.
  // This is the "expand node" in A* — called after search/overview.

  server.tool(
    "brain_get",
    "Get the full knowledge spec for a topic — 'navigate' for card + children cards, 'full' for complete spec",
    {
      topic: z.string().describe("Topic name or slug"),
      section: z.enum(["full", "navigate", "insights", "files", "sessions", "structure"]).default("full")
        .describe("Return only a specific section to save context"),
    },
    async ({ topic, section }) => {
      const { topics, slugToName } = getGraph();

      // Resolve: try name, then slug, then fuzzy
      let node = topics.get(topic);
      if (!node) {
        const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        const name = slugToName.get(slug);
        if (name) node = topics.get(name);
      }
      if (!node) {
        // Fuzzy fallback
        let bestMatch: TopicNode | null = null;
        let bestScore = 0;
        for (const n of topics.values()) {
          const s = fuzzyScore(topic, n.name);
          if (s > bestScore) { bestScore = s; bestMatch = n; }
        }
        if (bestMatch && bestScore > 0.4) node = bestMatch;
      }

      if (!node) {
        return { content: [{ type: "text" as const, text: `Topic "${topic}" not found. Use brain_overview or brain_search.` }] };
      }

      if (section === "full") {
        let text = node.fullMarkdown;
        if (node.children.length > 0) {
          text += "\n\n---\n## Sub-specs\n\n";
          for (const childName of node.children) {
            const childNode = topics.get(childName);
            if (childNode) text += formatCard(childNode) + "\n\n---\n\n";
          }
        }
        return { content: [{ type: "text" as const, text }] };
      }

      if (section === "navigate") {
        let text = formatCard(node);
        if (node.children.length > 0) {
          text += "\n\n## Sub-specs\n\n";
          for (const childName of node.children) {
            const childNode = topics.get(childName);
            if (childNode) text += formatCard(childNode) + "\n\n---\n\n";
          }
        }
        if (node.related.length > 0) {
          text += "\n## Related\n\n";
          for (const relName of node.related) {
            const relNode = topics.get(relName);
            if (relNode) text += formatCard(relNode) + "\n\n---\n\n";
          }
        }
        text += `\n_Use brain_get(name, section: "full") to expand any spec completely._`;
        return { content: [{ type: "text" as const, text }] };
      }

      // Section-specific extraction
      const parts: string[] = [`# ${node.name}`];

      if (section === "structure") {
        if (node.parent) parts.push(`Parent: ${node.parent}`);
        if (node.children.length) parts.push(`Children: ${node.children.join(", ")}`);
        if (node.related.length) parts.push(`Related: ${node.related.join(", ")}`);
        parts.push(`\n${node.summary.slice(0, 500)}`);
      }

      if (section === "insights") {
        const byCat = new Map<string, string[]>();
        for (const i of node.insights) {
          const list = byCat.get(i.category) || [];
          list.push(i.statement);
          byCat.set(i.category, list);
        }
        for (const [cat, statements] of byCat) {
          parts.push(`\n## ${cat}`);
          for (const s of statements) parts.push(`- ${s}`);
        }
      }

      if (section === "files") {
        for (const f of node.files) parts.push(`- \`${f}\``);
      }

      if (section === "sessions") {
        for (const s of node.sessions) {
          parts.push(`- ${s.date}: ${s.summary} (${s.moments} moments)`);
        }
      }

      return { content: [{ type: "text" as const, text: parts.join("\n") }] };
    },
  );

  // ── brain_traverse ────────────────────────────────────────────
  // Navigate from one topic to its neighbors: parent, children,
  // related, or topics sharing the same files.
  // Returns cards (not full specs) so agent can pick next step.

  server.tool(
    "brain_traverse",
    "Follow graph edges from a topic — especially useful for co-file discovery (specs sharing source files)",
    {
      from: z.string().describe("Starting topic name or slug"),
      direction: z.enum(["parent", "children", "related", "co-file"]).default("co-file")
        .describe("Which edges to follow"),
    },
    async ({ from, direction }) => {
      const { topics, slugToName, fileIndex } = getGraph();

      // Resolve topic
      let node = topics.get(from);
      if (!node) {
        const slug = from.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        const name = slugToName.get(slug);
        if (name) node = topics.get(name);
      }
      if (!node) {
        return { content: [{ type: "text" as const, text: `Topic "${from}" not found.` }] };
      }

      const neighbors: { name: string; via: string }[] = [];

      if (direction === "parent" && node.parent) {
        neighbors.push({ name: node.parent, via: "parent" });
      }

      if (direction === "children") {
        for (const c of node.children) neighbors.push({ name: c, via: "child" });
      }

      if (direction === "related") {
        for (const r of node.related) neighbors.push({ name: r, via: "related" });
      }

      if (direction === "co-file") {
        // Find topics that share files with this topic
        const coTopics = new Set<string>();
        for (const f of node.files) {
          const others = fileIndex.get(f) || [];
          for (const o of others) {
            if (o !== node.name) coTopics.add(o);
          }
        }
        for (const co of coTopics) neighbors.push({ name: co, via: "shared files" });
      }

      if (neighbors.length === 0) {
        return { content: [{ type: "text" as const, text: `No ${direction} neighbors for "${node.name}".` }] };
      }

      // Deduplicate
      const seen = new Set<string>();
      const unique = neighbors.filter((n) => {
        if (seen.has(n.name)) return false;
        seen.add(n.name);
        return true;
      });

      const text = unique.map((n) => {
        const neighbor = topics.get(n.name);
        if (!neighbor) return `- **${n.name}** _(${n.via})_ — not found in graph`;
        return `${formatCard(neighbor)}\n_edge: ${n.via}_`;
      }).join("\n\n---\n\n");

      return {
        content: [{ type: "text" as const, text: `## Neighbors of "${node.name}"\n\n${text}` }],
      };
    },
  );

  // ── brain_file_context ────────────────────────────────────────
  // Given a file path, return all relevant knowledge:
  // covering specs, their constraints/decisions, related specs.
  // This is the breadcrumb → knowledge bridge.

  server.tool(
    "brain_file_context",
    "Get brain knowledge for a source file — constraints, decisions, and related areas. Use before editing unfamiliar code.",
    {
      file: z.string().describe("File path (relative or absolute)"),
    },
    async ({ file }) => {
      const { topics, fileIndex } = getGraph();
      const normalized = file.replace(/^\.\//, "");

      // Find matching topics
      const matchingTopics = new Set<string>();
      for (const [indexedFile, topicNames] of fileIndex) {
        if (indexedFile === normalized || indexedFile.endsWith(normalized) || normalized.endsWith(indexedFile)) {
          for (const name of topicNames) matchingTopics.add(name);
        }
      }
      for (const node of topics.values()) {
        for (const f of node.files) {
          if (f.endsWith(normalized) || normalized.endsWith(f)) {
            matchingTopics.add(node.name);
          }
        }
      }

      if (matchingTopics.size === 0) {
        return { content: [{ type: "text" as const, text: `No specs cover "${file}".` }] };
      }

      const parts: string[] = [`# Context for \`${normalized}\`\n`];

      for (const name of matchingTopics) {
        const node = topics.get(name);
        if (!node) continue;

        // Card for the covering spec
        parts.push(formatCard(node));

        // Pull out constraints + decisions specifically (actionable when editing)
        const actionable = node.insights.filter(
          (i) => i.category === "constraint" || i.category === "decision"
        );
        if (actionable.length > 0) {
          parts.push("\n**Constraints & Decisions:**");
          for (const a of actionable) {
            parts.push(`- [${a.category}] ${a.statement}`);
          }
        }

        // Inherited from parent
        if (node.parent) {
          const parentNode = topics.get(node.parent);
          if (parentNode) {
            const inherited = parentNode.insights.filter(
              (i) => i.category === "constraint" || i.category === "decision"
            ).slice(0, 5);
            if (inherited.length > 0) {
              parts.push(`\n**Inherited from ${parentNode.name}:**`);
              for (const c of inherited) {
                parts.push(`- [${c.category}] ${c.statement}`);
              }
            }
          }
        }

        parts.push("\n---\n");
      }

      return { content: [{ type: "text" as const, text: parts.join("\n") }] };
    },
  );

  return server;
}

// ── Entry point ───────────────────────────────────────────────────

async function main() {
  const server = createBrainServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Brain MCP server failed:", err);
  process.exit(1);
});
