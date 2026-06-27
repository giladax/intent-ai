# Brain MCP Card Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every node in the brain graph navigable via cards — the LLM always sees compact, actionable context with clear next-step options.

**Architecture:** The card is the universal navigation atom. `brain_overview` shows root cards. `brain_get` expands a node into full content + child cards. `brain_traverse` returns neighbor cards. Every response ends with "where to go next" hints so the LLM never dead-ends.

**Tech Stack:** TypeScript, @modelcontextprotocol/sdk, Zod, filesystem-based (.repo/ markdown)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/mcp/server.ts` | MCP server — all 5 tools, graph loader, card formatter |
| `tests/mcp/server.test.ts` | Unit tests for card formatting, search scoring, graph loading |

Single file for now (~350 lines). Split only if it grows past 500.

---

### Task 1: Improve `formatCard` — richer, consistent navigation atom

The card must include enough for an LLM to decide "do I expand this node or move on?" Every card gets: name, level indicator, summary, top insights by category, child/related counts, and file count.

**Files:**
- Modify: `src/mcp/server.ts:190-210`
- Test: `tests/mcp/server.test.ts`

- [ ] **Step 1: Write test for formatCard output**

```typescript
import { describe, it, expect } from "vitest";
import { formatCard, parseTopic } from "../src/mcp/server.js";

describe("formatCard", () => {
  it("produces structured card with all sections", () => {
    const node = {
      name: "Pipeline Orchestration",
      slug: "pipeline-orchestration",
      summary: "The pipeline orchestrator transforms CC logs into structured SessionNarrative outputs.",
      parent: null,
      children: ["Database Infrastructure", "Moment Detection"],
      related: ["Brain Versioning"],
      insights: [
        { category: "structure", statement: "Two-model strategy: Haiku for classification, Sonnet for detection." },
        { category: "constraint", statement: "Must use streaming API." },
        { category: "decision", statement: "CC logs chosen over git diffs." },
        { category: "behavior", statement: "Single process, no IPC." },
      ],
      files: ["src/pipeline/orchestrator.ts", "src/cli/digest.ts", "src/llm/client.ts"],
      sessions: [{ date: "May 21", summary: "Built v2 from scratch", moments: 13 }],
      fullMarkdown: "",
    };

    const card = formatCard(node);
    expect(card).toContain("Pipeline Orchestration");
    expect(card).toContain("2 sub-specs");
    expect(card).toContain("3 files");
    expect(card).toContain("structure");
    expect(card).toContain("constraint");
    expect(card).toContain("Two-model strategy");
    expect(card).toContain("Database Infrastructure");
  });

  it("shows parent for child nodes", () => {
    const node = {
      name: "Database Infrastructure",
      slug: "database-infrastructure",
      summary: "Postgres + Drizzle ORM storage layer.",
      parent: "Pipeline Orchestration",
      children: [],
      related: [],
      insights: [{ category: "constraint", statement: "pgvector required." }],
      files: ["drizzle.config.ts"],
      sessions: [],
      fullMarkdown: "",
    };

    const card = formatCard(node);
    expect(card).toContain("↑ Pipeline Orchestration");
    expect(card).not.toContain("sub-specs");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mcp/server.test.ts`
Expected: FAIL — `formatCard` not exported, current format doesn't match

- [ ] **Step 3: Implement new formatCard and export it**

In `src/mcp/server.ts`, replace the `formatCard` function:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mcp/server.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp/server.ts tests/mcp/server.test.ts
git commit -m "feat(mcp): richer card format with category-diverse insights and nav hints"
```

---

### Task 2: Refine `brain_overview` — root cards instead of flat list

Currently overview is a flat bullet list. Replace with actual cards for each root so the LLM gets the same quality navigation atom everywhere.

**Files:**
- Modify: `src/mcp/server.ts` (brain_overview tool handler)

- [ ] **Step 1: Write test for overview returning cards**

```typescript
describe("brain_overview", () => {
  it("returns only root nodes as cards", async () => {
    // Integration test: call the tool via the server
    const { createBrainServer } = await import("../src/mcp/server.js");
    const server = createBrainServer();
    // Use server.tool handler directly — extract via internal API
    // For now test the formatting logic:
    // roots should have no parent, cards should contain sub-spec counts
  });
});
```

- [ ] **Step 2: Replace overview handler**

```typescript
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
```

- [ ] **Step 3: Smoke test**

Run: `printf '...' | timeout 5 npx tsx src/mcp/server.ts` (same pattern as before)
Expected: overview returns cards with `###` headings, insight snippets, nav hints

- [ ] **Step 4: Commit**

```bash
git add src/mcp/server.ts
git commit -m "feat(mcp): overview returns root cards sorted by knowledge density"
```

---

### Task 3: Refine `brain_get` — expand node shows full content + child cards

When you "expand" a node, you should see its full spec AND cards for all children — so you know where to go deeper without an extra traverse call.

**Files:**
- Modify: `src/mcp/server.ts` (brain_get tool handler)

- [ ] **Step 1: Update brain_get to append child cards when section=full**

```typescript
// After returning fullMarkdown, append child cards
if (section === "full" && node.children.length > 0) {
  let text = node.fullMarkdown;
  text += "\n\n---\n## Sub-specs\n\n";
  for (const childName of node.children) {
    const childNode = topics.get(childName);
    if (childNode) text += formatCard(childNode) + "\n\n---\n\n";
  }
  return { content: [{ type: "text" as const, text }] };
}
```

- [ ] **Step 2: Add a new section option "navigate" — card of self + child cards (lighter than full)**

Add `"navigate"` to the section enum:

```typescript
section: z.enum(["full", "navigate", "insights", "files", "sessions", "structure"]).default("full")
```

Handler for `navigate`:
```typescript
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
  return { content: [{ type: "text" as const, text }] };
}
```

- [ ] **Step 3: Smoke test brain_get with section=navigate**

Run with `{"name":"brain_get","arguments":{"topic":"Brain Versioning","section":"navigate"}}`
Expected: card for Brain Versioning + cards for Brain Insight Categories, Brain Synthesis Quality, Static Repo Index

- [ ] **Step 4: Commit**

```bash
git add src/mcp/server.ts
git commit -m "feat(mcp): brain_get navigate section shows self card + child/related cards"
```

---

### Task 4: Simplify `brain_traverse` — it's now redundant with navigate, repurpose as "expand edges"

With `brain_get(section: "navigate")` covering parent/children/related, `brain_traverse` becomes the tool for following specific edge types (especially co-file which navigate doesn't cover).

**Files:**
- Modify: `src/mcp/server.ts` (brain_traverse tool handler)

- [ ] **Step 1: Simplify traverse — focus on co-file discovery and multi-hop**

```typescript
server.tool(
  "brain_traverse",
  "Follow graph edges from a topic — especially useful for co-file discovery and cross-cutting concerns",
  {
    from: z.string().describe("Starting topic name or slug"),
    direction: z.enum(["parent", "children", "related", "co-file"]).default("co-file")
      .describe("Edge type to follow — co-file finds specs sharing the same source files"),
  },
  async ({ from, direction }) => {
    // ... resolve topic (same as before) ...

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
      const coTopics = new Set<string>();
      for (const f of node.files) {
        const others = fileIndex.get(f) || [];
        for (const o of others) {
          if (o !== node.name) coTopics.add(o);
        }
      }
      for (const co of coTopics) neighbors.push({ name: co, via: "shared files" });
    }

    // ... format as cards (same as before) ...
  },
);
```

- [ ] **Step 2: Remove "all" option — it was noisy, navigate covers it**

- [ ] **Step 3: Commit**

```bash
git add src/mcp/server.ts
git commit -m "refactor(mcp): traverse focuses on co-file edges, navigate handles tree walking"
```

---

### Task 5: `brain_file_context` — make it the breadcrumb trigger

This is the tool that fires when an agent opens a file. It should return exactly the constraints/decisions that matter for editing that file, plus cards of related areas for broader context.

**Files:**
- Modify: `src/mcp/server.ts` (brain_file_context tool handler)

- [ ] **Step 1: Write test for file context response structure**

```typescript
describe("brain_file_context", () => {
  it("returns constraints and decisions relevant to file", () => {
    // Given a file covered by a topic with parent constraints
    // The response should include:
    // 1. The covering spec's card
    // 2. Constraints + decisions from covering spec (not all insights)
    // 3. Inherited constraints from parent
    // 4. Related spec cards for broader context
  });
});
```

- [ ] **Step 2: Refine handler — prioritize actionable insights (constraints/decisions)**

```typescript
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

      // Pull out constraints + decisions specifically (these are what matter when editing)
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
```

- [ ] **Step 3: Smoke test**

Run with `{"name":"brain_file_context","arguments":{"file":"src/pipeline/orchestrator.ts"}}`
Expected: Card + constraints/decisions for Pipeline Orchestration (streaming API, sequential runs, etc.)

- [ ] **Step 4: Commit**

```bash
git add src/mcp/server.ts
git commit -m "feat(mcp): file_context focuses on constraints/decisions for editing guidance"
```

---

### Task 6: Export `parseTopic` and `formatCard` for testability + add unit tests

**Files:**
- Modify: `src/mcp/server.ts` (add exports)
- Create: `tests/mcp/server.test.ts`

- [ ] **Step 1: Add exports to server.ts**

Add `export` keyword to `parseTopic`, `formatCard`, `fuzzyScore`, and `loadBrainGraph`.

- [ ] **Step 2: Write unit tests**

```typescript
import { describe, it, expect } from "vitest";
import { formatCard, parseTopic, fuzzyScore } from "../src/mcp/server.js";

describe("fuzzyScore", () => {
  it("returns 1.0 for exact substring match", () => {
    expect(fuzzyScore("pipeline", "The pipeline orchestrator")).toBe(1.0);
  });

  it("returns partial score for word overlap", () => {
    const score = fuzzyScore("moment detection", "detecting moments in sessions");
    expect(score).toBeGreaterThan(0.3);
  });

  it("returns 0 for no match", () => {
    expect(fuzzyScore("banana", "pipeline orchestrator")).toBe(0);
  });
});

describe("parseTopic", () => {
  it("extracts parent from breadcrumb", () => {
    const md = `# Child Topic\n\n> Parent: [Pipeline Orchestration](pipeline-orchestration.md)\n\nSome summary.`;
    const node = parseTopic("child-topic", md);
    expect(node.parent).toBe("Pipeline Orchestration");
    expect(node.name).toBe("Child Topic");
  });

  it("extracts insights by category", () => {
    const md = `# Test\n\nSummary.\n\n## constraint\n\n- Must use streaming.\n- No SQLite.\n\n## decision\n\n- Chose Postgres.`;
    const node = parseTopic("test", md);
    expect(node.insights).toHaveLength(3);
    expect(node.insights[0]).toEqual({ category: "constraint", statement: "Must use streaming." });
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/mcp/server.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/mcp/server.ts tests/mcp/server.test.ts
git commit -m "test(mcp): unit tests for card formatting, parsing, and fuzzy scoring"
```

---

## Summary of changes

| Tool | Before | After |
|------|--------|-------|
| `brain_overview` | Flat bullet list | Root cards with insights + nav hints |
| `brain_get` | Full markdown dump | Full + child cards; new `navigate` section for lightweight tree walking |
| `brain_traverse` | All directions (noisy) | Focused on `co-file` discovery; tree walking moved to `navigate` |
| `brain_file_context` | Full spec dump + parent | Card + constraints/decisions only (actionable editing guidance) |
| `formatCard` | Basic: heading + summary + 3 insights | Richer: category-diverse insights, hierarchy indicator, nav hints with counts |
