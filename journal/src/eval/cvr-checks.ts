/**
 * Deterministic CVR constraint checks (measurement-v2 §3.5, fixes v1's F4).
 *
 * v1 hung every constraint verdict on a single Haiku call — one false
 * positive killed a true pass, one false negative faked one. v2 runs a
 * deterministic STRUCTURAL check over the final diff first; only constraints
 * the structural check cannot decide ("unknown") go to the LLM judge, and
 * there as a majority-of-3 vote (see mvp-judge.ts).
 *
 * Per CLAUDE.md's anti-pattern rule, regex here does structural parsing only:
 * unified-diff headers, added-line token presence. Anything semantic
 * (pattern-following, fabrication) stays "unknown" for the judge.
 */

export type CheckOutcome = "violated" | "clean" | "unknown";

export interface DiffFile {
  path: string;
  addedLines: string[];
}

/** Structural unified-diff parse: added lines grouped by target file. */
export function parseAddedLines(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;

  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      const target = line.slice(4).trim();
      if (target === "/dev/null") {
        current = null; // file deletion — nothing added
        continue;
      }
      const path = target.startsWith("b/") ? target.slice(2) : target;
      current = { path, addedLines: [] };
      files.push(current);
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++") && current) {
      current.addedLines.push(line.slice(1));
    }
  }
  return files;
}

// ── helpers over the parsed diff ─────────────────────────────────────

function addedIn(files: DiffFile[], pathPrefix: string): string[] {
  return files
    .filter((f) => f.path.startsWith(pathPrefix))
    .flatMap((f) => f.addedLines);
}

function anyLine(lines: string[], re: RegExp): boolean {
  return lines.some((l) => re.test(l));
}

// ── per-constraint checkers ──────────────────────────────────────────

type Checker = (files: DiffFile[]) => CheckOutcome;

const INSTRUMENT_TOKENS = /emitRead|buildMcpReadEvent|emitMcpReadEvent/;
const TRANSPORT_TOKENS =
  /SSEServerTransport|WebSocketServer|StreamableHTTPServerTransport|createServer\(|express\(|\.listen\(/;
const RAW_DB_TOKENS = /getClient\(|postgres\(|sql\.unsafe|drizzle\(/;

const CHECKERS: Record<string, Checker> = {
  // task-1 — new brain read tool must self-instrument
  "instrument-mcp-read": (files) => {
    const mcpLines = addedIn(files, "src/mcp/");
    if (!anyLine(mcpLines, /brain_recent/)) return "unknown";
    return anyLine(mcpLines, INSTRUMENT_TOKENS) ? "clean" : "violated";
  },

  // task-1 — no second transport/server
  "no-new-transport": (files) => {
    const all = files.flatMap((f) => f.addedLines);
    return anyLine(all, TRANSPORT_TOKENS) ? "violated" : "clean";
  },

  // task-2 — session time, not digest time
  "occurred-time-not-digest-time": (files) => {
    const lines = addedIn(files, "src/pipeline/");
    const stamped = lines.filter((l) => /timestamp:/.test(l));
    if (stamped.length === 0) return "unknown";
    const bareWallClock = stamped.some(
      (l) => /timestamp:\s*new Date\(\)/.test(l) && !l.includes("??"),
    );
    return bareWallClock ? "violated" : "clean";
  },

  // task-2 — sourceType/sourceId back-references on new events
  "source-backrefs": (files) => {
    const lines = addedIn(files, "src/pipeline/emit-events.ts");
    if (lines.length === 0) return "unknown";
    if (anyLine(lines, /sourceType/)) return "clean";
    return anyLine(lines, /events\.push\(|category:/) ? "violated" : "unknown";
  },

  // task-3 — never edit applied migrations; new migration from schema.ts
  "schema-ts-source-of-truth": (files) => {
    if (files.some((f) => /^drizzle\/0000/.test(f.path))) return "violated";
    const touchedSchema = files.some((f) => f.path === "src/storage/schema.ts");
    const newMigration = files.some(
      (f) => f.path.startsWith("drizzle/") && !/^drizzle\/0000/.test(f.path),
    );
    return touchedSchema || newMigration ? "clean" : "unknown";
  },

  // task-3 — DDL only inside drizzle/
  "no-out-of-band-ddl": (files) => {
    const outside = files
      .filter((f) => !f.path.startsWith("drizzle/"))
      .flatMap((f) => f.addedLines);
    return anyLine(outside, /CREATE INDEX|ALTER TABLE/i) ? "violated" : "clean";
  },

  // task-4 — no defaults on evidence fields of the extraction schema
  "no-evidence-defaults": (files) => {
    const schemaLines = addedIn(files, "src/llm/prompts/understand/extract.ts");
    return anyLine(schemaLines, /\.default\(/) ? "violated" : "clean";
  },

  // task-4 — semantic (did code fabricate evidence?) — judge decides
  "drop-dont-fabricate": () => "unknown",

  // task-5 — no parallel events query in the CLI
  "reuse-events-query-path": (files) => {
    const cliLines = addedIn(files, "src/cli/");
    if (anyLine(cliLines, /FROM activity_events|sql\.unsafe|sql`/)) {
      return "violated";
    }
    return "unknown"; // render-only claim needs the judge's confirmation
  },

  // task-5 — CLI goes through src/storage/queries.ts, never raw Postgres
  "cli-through-queries-layer": (files) => {
    const cliLines = addedIn(files, "src/cli/");
    return anyLine(cliLines, RAW_DB_TOKENS) ? "violated" : "clean";
  },
};

/**
 * Run the deterministic structural check for one constraint over the final
 * diff. "unknown" means the structural evidence cannot decide — send it to
 * the Haiku majority judge.
 */
export function checkConstraint(constraintId: string, diff: string): CheckOutcome {
  const checker = CHECKERS[constraintId];
  if (!checker) return "unknown";
  return checker(parseAddedLines(diff));
}
