import { describe, it, expect } from "vitest";
import {
  parseAddedLines,
  checkConstraint,
} from "../../src/eval/cvr-checks.js";

// ── diff builder ─────────────────────────────────────────────────────

function diffOf(path: string, added: string[], removed: string[] = []): string {
  return [
    `diff --git a/${path} b/${path}`,
    `index 0000000..1111111 100644`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${removed.length + 1} +1,${added.length + 1} @@`,
    " context line",
    ...removed.map((l) => `-${l}`),
    ...added.map((l) => `+${l}`),
  ].join("\n");
}

// ── parseAddedLines ──────────────────────────────────────────────────

describe("parseAddedLines", () => {
  it("collects added lines per file, stripping the + prefix", () => {
    const diff = diffOf("src/a.ts", ["const x = 1;", "const y = 2;"]);
    const files = parseAddedLines(diff);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/a.ts");
    expect(files[0].addedLines).toEqual(["const x = 1;", "const y = 2;"]);
  });

  it("ignores removed and context lines and the +++ header", () => {
    const diff = diffOf("src/a.ts", ["kept"], ["gone"]);
    const files = parseAddedLines(diff);
    expect(files[0].addedLines).toEqual(["kept"]);
  });

  it("handles multiple files", () => {
    const diff = diffOf("src/a.ts", ["a"]) + "\n" + diffOf("src/b.ts", ["b"]);
    const files = parseAddedLines(diff);
    expect(files.map((f) => f.path)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("handles new files (--- /dev/null)", () => {
    const diff = [
      "diff --git a/drizzle/0001_add_index.sql b/drizzle/0001_add_index.sql",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/drizzle/0001_add_index.sql",
      "@@ -0,0 +1 @@",
      '+CREATE INDEX "idx" ON "activity_events" ("category");',
    ].join("\n");
    const files = parseAddedLines(diff);
    expect(files[0].path).toBe("drizzle/0001_add_index.sql");
    expect(files[0].addedLines).toHaveLength(1);
  });

  it("returns [] on empty diff", () => {
    expect(parseAddedLines("")).toEqual([]);
  });
});

// ── task-1: instrument-mcp-read ──────────────────────────────────────

describe("instrument-mcp-read", () => {
  it("violated: brain_recent registered without any instrumentation call", () => {
    const diff = diffOf("src/mcp/server.ts", [
      '  server.tool(',
      '    "brain_recent",',
      '    "Latest activity events",',
      "    async ({ n }) => mcpText(render(await queryEvents({ limit: n }))),",
      "  );",
    ]);
    expect(checkConstraint("instrument-mcp-read", diff)).toBe("violated");
  });

  it("clean: handler emits via emitRead", () => {
    const diff = diffOf("src/mcp/server.ts", [
      '  server.tool(',
      '    "brain_recent",',
      "    async ({ n }) => {",
      '      await emitRead("recent", startedAt, "hit", `Agent asked for ${n} recent events`);',
      "      return mcpText(text);",
      "    },",
      "  );",
    ]);
    expect(checkConstraint("instrument-mcp-read", diff)).toBe("clean");
  });

  it("unknown: no brain_recent registration in the diff", () => {
    const diff = diffOf("src/web/server.ts", ["const a = 1;"]);
    expect(checkConstraint("instrument-mcp-read", diff)).toBe("unknown");
  });
});

// ── task-1: no-new-transport ─────────────────────────────────────────

describe("no-new-transport", () => {
  it("violated on SSE transport import", () => {
    const diff = diffOf("src/mcp/server.ts", [
      'import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";',
    ]);
    expect(checkConstraint("no-new-transport", diff)).toBe("violated");
  });

  it("violated on a new listen()", () => {
    const diff = diffOf("src/mcp/http.ts", ["app.listen(8080);"]);
    expect(checkConstraint("no-new-transport", diff)).toBe("violated");
  });

  it("clean when no transport tokens added", () => {
    const diff = diffOf("src/mcp/server.ts", ['server.tool("brain_recent", ...);']);
    expect(checkConstraint("no-new-transport", diff)).toBe("clean");
  });
});

// ── task-2: occurred-time-not-digest-time ────────────────────────────

describe("occurred-time-not-digest-time", () => {
  it("violated: new event stamped with bare new Date()", () => {
    const diff = diffOf("src/pipeline/emit-events.ts", [
      "  events.push({",
      "    timestamp: new Date(),",
      '    category: "discovery:narrative",',
      "  });",
    ]);
    expect(checkConstraint("occurred-time-not-digest-time", diff)).toBe("violated");
  });

  it("clean: stamped with sessionTs", () => {
    const diff = diffOf("src/pipeline/emit-events.ts", [
      "  events.push({",
      "    timestamp: sessionTs,",
      '    category: "discovery:narrative",',
      "  });",
    ]);
    expect(checkConstraint("occurred-time-not-digest-time", diff)).toBe("clean");
  });

  it("clean: new Date() only as ?? fallback (established pattern)", () => {
    const diff = diffOf("src/pipeline/emit-events.ts", [
      "    timestamp: input.sessionEndedAt ?? new Date(),",
    ]);
    expect(checkConstraint("occurred-time-not-digest-time", diff)).toBe("clean");
  });

  it("unknown when no timestamps added", () => {
    const diff = diffOf("src/pipeline/emit-events.ts", ["const n = 1;"]);
    expect(checkConstraint("occurred-time-not-digest-time", diff)).toBe("unknown");
  });
});

// ── task-2: source-backrefs ──────────────────────────────────────────

describe("source-backrefs", () => {
  it("clean when sourceType is carried", () => {
    const diff = diffOf("src/pipeline/emit-events.ts", [
      "  events.push({",
      '    sourceType: "narrative",',
      "    sourceId: input.sessionId,",
      "  });",
    ]);
    expect(checkConstraint("source-backrefs", diff)).toBe("clean");
  });

  it("violated when new events pushed without sourceType", () => {
    const diff = diffOf("src/pipeline/emit-events.ts", [
      "  events.push({",
      "    timestamp: sessionTs,",
      '    category: "discovery:narrative",',
      "    tags: [],",
      "  });",
    ]);
    expect(checkConstraint("source-backrefs", diff)).toBe("violated");
  });

  it("unknown when emit-events untouched", () => {
    const diff = diffOf("src/web/server.ts", ["const a = 1;"]);
    expect(checkConstraint("source-backrefs", diff)).toBe("unknown");
  });
});

// ── task-3: schema-ts-source-of-truth ────────────────────────────────

describe("schema-ts-source-of-truth", () => {
  it("violated when the baseline migration is edited", () => {
    const diff = diffOf("drizzle/0000_baseline.sql", [
      'CREATE INDEX "idx_ae_category" ON "activity_events" ("category");',
    ]);
    expect(checkConstraint("schema-ts-source-of-truth", diff)).toBe("violated");
  });

  it("clean when schema.ts + a new migration change", () => {
    const diff =
      diffOf("src/storage/schema.ts", ["  categoryIdx: index().on(t.category),"]) +
      "\n" +
      diffOf("drizzle/0001_category_index.sql", [
        'CREATE INDEX "idx_ae_category" ON "activity_events" ("category");',
      ]);
    expect(checkConstraint("schema-ts-source-of-truth", diff)).toBe("clean");
  });

  it("unknown when neither schema nor migrations touched", () => {
    const diff = diffOf("src/cli/index.ts", ["const a = 1;"]);
    expect(checkConstraint("schema-ts-source-of-truth", diff)).toBe("unknown");
  });
});

// ── task-3: no-out-of-band-ddl ───────────────────────────────────────

describe("no-out-of-band-ddl", () => {
  it("violated on CREATE INDEX in application code", () => {
    const diff = diffOf("src/storage/queries.ts", [
      '  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx ON activity_events (category)`);',
    ]);
    expect(checkConstraint("no-out-of-band-ddl", diff)).toBe("violated");
  });

  it("clean on DDL inside drizzle/", () => {
    const diff = diffOf("drizzle/0001_category_index.sql", [
      'CREATE INDEX "idx_ae_category" ON "activity_events" ("category");',
    ]);
    expect(checkConstraint("no-out-of-band-ddl", diff)).toBe("clean");
  });
});

// ── task-4: no-evidence-defaults ─────────────────────────────────────

describe("no-evidence-defaults", () => {
  it("violated when a default lands on the extraction schema", () => {
    const diff = diffOf("src/llm/prompts/understand/extract.ts", [
      '  quote: z.string().optional().default(""),',
    ]);
    expect(checkConstraint("no-evidence-defaults", diff)).toBe("violated");
  });

  it("clean when the schema keeps min(1) and code filters instead", () => {
    const diff = diffOf("src/pipeline/understand/extract.ts", [
      "  const valid = claims.filter((c) => c.evidence.length > 0);",
    ]);
    expect(checkConstraint("no-evidence-defaults", diff)).toBe("clean");
  });
});

// ── task-4: drop-dont-fabricate (judge-only) ─────────────────────────

describe("drop-dont-fabricate", () => {
  it("is always unknown (Haiku majority decides)", () => {
    const diff = diffOf("src/pipeline/understand/extract.ts", ["anything"]);
    expect(checkConstraint("drop-dont-fabricate", diff)).toBe("unknown");
  });
});

// ── task-5: reuse-events-query-path ──────────────────────────────────

describe("reuse-events-query-path", () => {
  it("violated on a parallel query in the CLI", () => {
    const diff = diffOf("src/cli/index.ts", [
      "  const rows = await sql.unsafe(`SELECT * FROM activity_events LIMIT 20`);",
    ]);
    expect(checkConstraint("reuse-events-query-path", diff)).toBe("violated");
  });

  it("unknown when the CLI change looks render-only (judge confirms)", () => {
    const diff = diffOf("src/cli/index.ts", [
      "  if (opts.json) process.stdout.write(JSON.stringify(events));",
    ]);
    expect(checkConstraint("reuse-events-query-path", diff)).toBe("unknown");
  });
});

// ── task-5: cli-through-queries-layer ────────────────────────────────

describe("cli-through-queries-layer", () => {
  it("violated when the CLI grabs a raw client", () => {
    const diff = diffOf("src/cli/index.ts", [
      '  const sql = getClient();',
    ]);
    expect(checkConstraint("cli-through-queries-layer", diff)).toBe("violated");
  });

  it("clean when src/cli additions have no raw DB access", () => {
    const diff = diffOf("src/cli/index.ts", [
      '  .option("--json", "Emit JSON")',
    ]);
    expect(checkConstraint("cli-through-queries-layer", diff)).toBe("clean");
  });
});

// ── unregistered ids ─────────────────────────────────────────────────

describe("unregistered constraint ids", () => {
  it("fall through to unknown", () => {
    expect(checkConstraint("nonexistent-rule", "anything")).toBe("unknown");
  });
});
