import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join, resolve } from "path";
import {
  getDefaultProjectId,
  listFeatures,
  getFeatureById,
  getFeatureFileRows,
  loadFeatureContext,
  insertObservation,
  type FeatureRecord,
} from "../storage/queries.js";
import {
  tokenize,
  fuzzyScore,
  resolveFeature,
  resolveTask,
  formatCandidates,
  formatFeatureContext,
} from "./feature.js";
import {
  buildMcpReadEvent,
  emitMcpReadEvent,
  getRepoContext,
  type McpOutcome,
} from "./instrument.js";

// Re-export the shared text-scoring helpers (used by the legacy topic tools
// and covered by tests/mcp/server.test.ts).
export { tokenize, fuzzyScore };

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
// tokenize / fuzzyScore are imported from ./feature.js (shared with the
// Feature tools) and re-exported above.

// ── Feature-tool helpers (Postgres-backed) ───────────────────────────

function mcpText(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function featureContextResponse(featureId: string) {
  const ctx = await loadFeatureContext(featureId);
  if (!ctx) return mcpText(`Feature ${featureId} not found.`);
  return mcpText(formatFeatureContext(ctx));
}

async function featuresByIds(ids: string[], projectId: string | null): Promise<FeatureRecord[]> {
  // On 0 candidates, surface the full project Feature list so the agent
  // can pick — we never silently guess, but we do help it choose.
  if (ids.length === 0) return await listFeatures(projectId ?? undefined);
  const out: FeatureRecord[] = [];
  for (const id of ids) {
    const f = await getFeatureById(id);
    if (f) out.push(f);
  }
  return out;
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

  // ── Self-instrumentation (Journal §7.3 / API review F5, F6) ─────
  // Every read emits an `mcp:<tool>` event, failure-safe. Actor comes from
  // MCP client info; repo/branch are stamped server-side.

  const repoCtx = getRepoContext();

  function actorName(): string {
    try {
      const client = server.server.getClientVersion();
      return client?.name ? `agent:${client.name}` : "agent:mcp-client";
    } catch {
      return "agent:mcp-client";
    }
  }

  async function emitRead(
    tool: string,
    startedAt: number,
    outcome: McpOutcome,
    summary: string,
    extra?: { sessionId?: string; featureId?: string; metadata?: Record<string, unknown> },
  ): Promise<void> {
    await emitMcpReadEvent(
      buildMcpReadEvent({
        tool,
        outcome,
        summary,
        latencyMs: Date.now() - startedAt,
        actor: actorName(),
        repo: repoCtx.repo,
        branch: repoCtx.branch,
        sessionId: extra?.sessionId,
        featureId: extra?.featureId,
        metadata: extra?.metadata,
      }),
    );
  }

  // ── brain_overview ────────────────────────────────────────────
  // Entry point: compact tree with one-line summaries.
  // Agent reads this first to orient, then drills in.

  server.tool(
    "brain_overview",
    "Get top-level knowledge areas as cards — start here, then drill into any area",
    {},
    async () => {
      const startedAt = Date.now();
      const { topics } = getGraph();
      const roots = [...topics.values()].filter((t) => !t.parent);

      // Sort by insight count descending (most knowledge-rich first)
      roots.sort((a, b) => b.insights.length - a.insights.length);

      const cards = roots.map((r) => formatCard(r));

      let text = `# Brain — ${roots.length} Top-Level Areas\n\n`;
      text += cards.join("\n\n---\n\n");
      text += `\n\n---\n_${topics.size} specs total. Use brain_get(name) to expand, brain_traverse(name) for neighbors._`;

      await emitRead(
        "overview",
        startedAt,
        roots.length > 0 ? "hit" : "miss",
        `Agent viewed the brain overview (${roots.length} top-level areas)`,
        { metadata: { areas: roots.length } },
      );
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
      const startedAt = Date.now();
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

      await emitRead(
        "search",
        startedAt,
        sorted.length > 0 ? "hit" : "miss",
        `Agent searched the brain for "${query}" — ${sorted.length} result${sorted.length === 1 ? "" : "s"}`,
        { metadata: { query, prism, results: sorted.length } },
      );

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
      const startedAt = Date.now();
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
        await emitRead("get", startedAt, "miss", `Agent requested topic "${topic}" — not found`, {
          metadata: { topic, section },
        });
        return { content: [{ type: "text" as const, text: `Topic "${topic}" not found. Use brain_overview or brain_search.` }] };
      }

      await emitRead("get", startedAt, "hit", `Agent read topic "${node.name}" (${section})`, {
        metadata: { topic: node.name, section },
      });

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
      const startedAt = Date.now();
      const { topics, slugToName, fileIndex } = getGraph();

      // Resolve topic
      let node = topics.get(from);
      if (!node) {
        const slug = from.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        const name = slugToName.get(slug);
        if (name) node = topics.get(name);
      }
      if (!node) {
        await emitRead("traverse", startedAt, "miss", `Agent traversed from "${from}" — topic not found`, {
          metadata: { from, direction },
        });
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

      await emitRead(
        "traverse",
        startedAt,
        neighbors.length > 0 ? "hit" : "miss",
        `Agent traversed ${direction} from "${node.name}" — ${neighbors.length} neighbor${neighbors.length === 1 ? "" : "s"}`,
        { metadata: { from: node.name, direction, neighbors: neighbors.length } },
      );

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

  // ── brain_file_context (re-keyed onto Feature) ────────────────
  // Given a file path, resolve its Feature via the file↔Feature map
  // (longest-glob-wins) and return the Feature's served context. On 0 or
  // >1 matching Features, returns the candidate list — never guesses.

  server.tool(
    "brain_file_context",
    "Get Brain context for a source file — resolves the file's Feature and returns its current understanding, constraints, and relevant files. Use before editing unfamiliar code.",
    {
      file: z.string().describe("File path (relative or absolute)"),
      sessionId: z.string().optional().describe("Your session id, for provenance"),
    },
    async ({ file, sessionId }) => {
      const startedAt = Date.now();
      try {
        const projectId = await getDefaultProjectId();
        const rows = await getFeatureFileRows(projectId ?? undefined);
        const res = resolveFeature(file, rows);
        if (res.featureId) {
          await emitRead("file-context", startedAt, "hit", `Agent got feature context for ${file}`, {
            sessionId, featureId: res.featureId, metadata: { file },
          });
          return await featureContextResponse(res.featureId);
        }
        const outcome: McpOutcome = res.candidateIds.length === 0 ? "miss" : "candidates";
        await emitRead(
          "file-context",
          startedAt,
          outcome,
          outcome === "miss"
            ? `Agent asked for context on ${file} — no Feature maps it`
            : `Agent asked for context on ${file} — ${res.candidateIds.length} candidate Features`,
          { sessionId, metadata: { file, candidates: res.candidateIds.length } },
        );
        const candidates = await featuresByIds(res.candidateIds, projectId);
        return mcpText(formatCandidates(candidates, `file: ${file}`));
      } catch (err) {
        await emitRead("file-context", startedAt, "error", `brain_file_context failed for ${file}`, {
          sessionId, metadata: { file, error: errMsg(err) },
        });
        return mcpText(`brain_file_context unavailable: ${errMsg(err)}`);
      }
    },
  );

  // ── brain_enter ───────────────────────────────────────────────
  // The primary entry point for agents. Keyed by file OR task/goal.
  // Resolves to a Feature and returns its served context; on 0 or >1
  // matches returns the candidate list for the agent to pick.

  server.tool(
    "brain_enter",
    "Enter the Brain for a file or task. Returns the Feature's current understanding, constraints, relevant files, related sessions, and known unknowns. On 0 or >1 matches, returns the candidate list to pick from — never guesses.",
    {
      file: z.string().optional().describe("File path you are about to work on"),
      task: z.string().optional().describe("Task or goal description"),
      sessionId: z.string().optional().describe("Your session id, for provenance"),
    },
    async ({ file, task, sessionId }) => {
      const startedAt = Date.now();
      const target = file ? `file ${file}` : task ? `task "${task}"` : "nothing";
      try {
        const projectId = await getDefaultProjectId();
        if (file) {
          const rows = await getFeatureFileRows(projectId ?? undefined);
          const res = resolveFeature(file, rows);
          if (res.featureId) {
            await emitRead("enter", startedAt, "hit", `Agent entered the Brain for ${target}`, {
              sessionId, featureId: res.featureId, metadata: { file },
            });
            return await featureContextResponse(res.featureId);
          }
          const outcome: McpOutcome = res.candidateIds.length === 0 ? "miss" : "candidates";
          await emitRead(
            "enter",
            startedAt,
            outcome,
            outcome === "miss"
              ? `Agent entered for ${target} — no Feature maps it`
              : `Agent entered for ${target} — ${res.candidateIds.length} candidate Features`,
            { sessionId, metadata: { file, candidates: res.candidateIds.length } },
          );
          const candidates = await featuresByIds(res.candidateIds, projectId);
          return mcpText(formatCandidates(candidates, `file: ${file}`));
        }
        if (task) {
          const features = await listFeatures(projectId ?? undefined);
          const res = resolveTask(task, features);
          if (res.feature) {
            await emitRead("enter", startedAt, "hit", `Agent entered the Brain for ${target}`, {
              sessionId, featureId: res.feature.id, metadata: { task },
            });
            return await featureContextResponse(res.feature.id);
          }
          const outcome: McpOutcome = res.candidates.length === 0 ? "miss" : "candidates";
          await emitRead(
            "enter",
            startedAt,
            outcome,
            outcome === "miss"
              ? `Agent entered for ${target} — no Feature matched`
              : `Agent entered for ${target} — ${res.candidates.length} candidate Features`,
            { sessionId, metadata: { task, candidates: res.candidates.length } },
          );
          return mcpText(formatCandidates(res.candidates, `task: ${task}`));
        }
        return mcpText("Provide either `file` or `task` to enter the Brain.");
      } catch (err) {
        await emitRead("enter", startedAt, "error", `brain_enter failed for ${target}`, {
          sessionId, metadata: { file: file ?? null, task: task ?? null, error: errMsg(err) },
        });
        return mcpText(`brain_enter unavailable: ${errMsg(err)}`);
      }
    },
  );

  // ── brain_feature_context ─────────────────────────────────────
  // Fetch a Feature's served context directly by id (after picking from
  // a candidate list returned by brain_enter / brain_file_context).

  server.tool(
    "brain_feature_context",
    "Get the served context for a Feature by id: summary, current understanding, constraints, relevant files, related sessions, known unknowns, and agent instructions.",
    {
      featureId: z.string().describe("Feature id (from a candidate list)"),
      sessionId: z.string().optional().describe("Your session id, for provenance"),
    },
    async ({ featureId, sessionId }) => {
      const startedAt = Date.now();
      try {
        const ctx = await loadFeatureContext(featureId);
        await emitRead(
          "feature-context",
          startedAt,
          ctx ? "hit" : "miss",
          ctx
            ? `Agent got context for Feature "${ctx.feature.name}"`
            : `Agent requested Feature ${featureId} — not found`,
          { sessionId, featureId, metadata: {} },
        );
        if (!ctx) return mcpText(`Feature ${featureId} not found.`);
        return mcpText(formatFeatureContext(ctx));
      } catch (err) {
        await emitRead("feature-context", startedAt, "error", `brain_feature_context failed for ${featureId}`, {
          sessionId, featureId, metadata: { error: errMsg(err) },
        });
        return mcpText(`brain_feature_context unavailable: ${errMsg(err)}`);
      }
    },
  );

  // ── Write-side tools ──────────────────────────────────────────
  // Each inserts an activity_events row with category observation:<kind>,
  // feature_id set, review_status 'pending'. No automatic promotion — a
  // human reviews. Failures are reported, never thrown to the agent.

  server.tool(
    "brain_report_observation",
    "Report an observation about a Feature (something you noticed while working). Stored pending human review.",
    {
      featureId: z.string().optional().describe("Feature this observation is about"),
      summary: z.string().describe("The observation, in one or two sentences"),
      kind: z.string().optional().describe("Observation kind tag, e.g. tech-debt, decision, behavior"),
      tags: z.array(z.string()).optional().describe("Freeform tags"),
      files: z.array(z.string()).optional().describe("Related file paths"),
      sessionId: z.string().optional().describe("Your session id, for provenance"),
    },
    async ({ featureId, summary, kind, tags, files, sessionId }) => {
      try {
        const id = await insertObservation({
          kind: kind ?? "observation",
          summary,
          featureId: featureId ?? null,
          actor: actorName(),
          sessionId: sessionId ?? null,
          repo: repoCtx.repo ?? null,
          branch: repoCtx.branch ?? null,
          tags,
          files,
          metadata: { kind: kind ?? "observation" },
        });
        return mcpText(`Observation recorded (id: ${id}, status: pending review).`);
      } catch (err) {
        return mcpText(`Could not record observation: ${errMsg(err)}`);
      }
    },
  );

  server.tool(
    "brain_report_unknown",
    "Report an open question / unknown about a Feature — something Brain does not yet know. Stored pending human review.",
    {
      featureId: z.string().optional().describe("Feature this unknown relates to"),
      summary: z.string().describe("The open question or unknown"),
      files: z.array(z.string()).optional(),
      sessionId: z.string().optional().describe("Your session id, for provenance"),
    },
    async ({ featureId, summary, files, sessionId }) => {
      try {
        const id = await insertObservation({
          kind: "unknown",
          summary,
          featureId: featureId ?? null,
          actor: actorName(),
          sessionId: sessionId ?? null,
          repo: repoCtx.repo ?? null,
          branch: repoCtx.branch ?? null,
          files,
        });
        return mcpText(`Unknown recorded (id: ${id}, status: pending review).`);
      } catch (err) {
        return mcpText(`Could not record unknown: ${errMsg(err)}`);
      }
    },
  );

  server.tool(
    "brain_rate_context",
    "Rate how useful the Feature context was for your task (self-report). Stored as a pending observation.",
    {
      featureId: z.string().optional(),
      rating: z.number().int().min(1).max(5).describe("Usefulness rating, 1 (useless) to 5 (decisive)"),
      comment: z.string().optional().describe("Optional note about what was missing or helpful"),
      sessionId: z.string().optional().describe("Your session id, for provenance"),
    },
    async ({ featureId, rating, comment, sessionId }) => {
      try {
        const id = await insertObservation({
          kind: "context-rating",
          summary: comment ?? `Context usefulness rating: ${rating}`,
          featureId: featureId ?? null,
          actor: actorName(),
          sessionId: sessionId ?? null,
          repo: repoCtx.repo ?? null,
          branch: repoCtx.branch ?? null,
          metadata: { rating, comment: comment ?? null },
        });
        return mcpText(`Context rating recorded (id: ${id}).`);
      } catch (err) {
        return mcpText(`Could not record rating: ${errMsg(err)}`);
      }
    },
  );

  server.tool(
    "brain_propose_knowledge_delta",
    "Propose a change to a Feature's understanding (a reviewable delta). Stored pending human review — Brain never edits understanding silently.",
    {
      featureId: z.string().optional(),
      summary: z.string().describe("Proposed change to the understanding"),
      before: z.string().optional().describe("Current understanding being changed"),
      after: z.string().optional().describe("Proposed new understanding"),
      sessionId: z.string().optional().describe("Your session id, for provenance"),
    },
    async ({ featureId, summary, before, after, sessionId }) => {
      try {
        const id = await insertObservation({
          kind: "knowledge-delta",
          summary,
          featureId: featureId ?? null,
          actor: actorName(),
          sessionId: sessionId ?? null,
          repo: repoCtx.repo ?? null,
          branch: repoCtx.branch ?? null,
          metadata: { before: before ?? null, after: after ?? null },
        });
        return mcpText(`Knowledge delta proposed (id: ${id}, status: pending review).`);
      } catch (err) {
        return mcpText(`Could not propose knowledge delta: ${errMsg(err)}`);
      }
    },
  );

  return server;
}

// ── Entry point ───────────────────────────────────────────────────

export async function startMcpServer() {
  const server = createBrainServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
