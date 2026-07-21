/**
 * Deterministic transcript metrics for the MVP measurement harness.
 *
 * ETC — Exploratory Tool-calls to first Correct edit. Read/Grep/Glob/search
 * calls made before the first Edit/Write in a task-correct file. Extracted
 * deterministically from a Claude Code session JSONL via the existing adapter
 * (src/adapters/claude-code.ts → @constellos/claude-code-kit), so we dogfood
 * the same logs we digest.
 *
 * Per CLAUDE.md anti-patterns: regex here is used ONLY for structural parsing
 * (block index from an event id, file-path glob → regex). No semantic/
 * behavioral classification is done with regex.
 */

import { parseClaudeCodeLog } from "../adapters/claude-code.js";
import type { RawDevEvent } from "../adapters/types.js";

// ── Tool taxonomy ────────────────────────────────────────────────────

/**
 * Brain MCP READ tools (measurement-v2 §3.5, fixes F3): the treatment arm's
 * brain consults are information-gathering and MUST cost ETC like a Grep
 * does — otherwise ETC measures which tool namespace explored, not how much
 * exploration happened. Write tools (report/rate/propose) are not
 * information-gathering and are excluded.
 */
export const BRAIN_READ_TOOLS = new Set<string>([
  "mcp__intent-brain__brain_enter",
  "mcp__intent-brain__brain_search",
  "mcp__intent-brain__brain_feature_context",
  "mcp__intent-brain__brain_file_context",
  "mcp__intent-brain__brain_overview",
  "mcp__intent-brain__brain_get",
  "mcp__intent-brain__brain_traverse",
]);

/** Tools that count as exploration (information-gathering, no mutation). */
export const EXPLORATORY_TOOLS = new Set<string>([
  "Read",
  "Grep",
  "Glob",
  "NotebookRead",
  "WebSearch",
  "WebFetch",
  "ListMcpResourcesTool",
  "ReadMcpResourceTool",
  ...BRAIN_READ_TOOLS,
]);

/** Tools that mutate a file (the edit we measure ETC against). */
export const EDIT_TOOLS = new Set<string>([
  "Edit",
  "MultiEdit",
  "Write",
  "NotebookEdit",
]);

// ── Tool call extraction ─────────────────────────────────────────────

export interface ToolCall {
  /** order across the whole transcript (0-based) */
  index: number;
  /** tool name, e.g. "Read" / "Edit" */
  name: string;
  /** tool input object, verbatim */
  input: Record<string, unknown>;
  /** file_path from input, if present */
  filePath?: string;
  /** ISO timestamp */
  timestamp: string;
}

/**
 * Extract tool calls (in order) from already-parsed raw events.
 *
 * The adapter emits one `tool_call` RawDevEvent per tool_use block, with an id
 * of the form `<uuid>-tool-<i>` and the full message preserved in `raw`. We
 * recover the originating block by its index so messages with multiple
 * tool_use blocks are not double counted.
 */
export function extractToolCalls(rawEvents: RawDevEvent[]): ToolCall[] {
  const calls: ToolCall[] = [];
  let order = 0;

  for (const ev of rawEvents) {
    if (ev.type !== "tool_call") continue;

    // Structural parse: recover the tool_use block index from the event id.
    const m = ev.id.match(/-tool-(\d+)$/);
    const blockIdx = m ? Number(m[1]) : 0;

    const message = (ev.raw as { message?: unknown }).message as
      | { content?: unknown }
      | undefined;
    const content = message?.content;
    if (!Array.isArray(content)) continue;

    const block = content[blockIdx] as
      | { type?: string; name?: string; input?: unknown }
      | undefined;
    if (!block || block.type !== "tool_use" || typeof block.name !== "string") {
      continue;
    }

    const input =
      block.input && typeof block.input === "object"
        ? (block.input as Record<string, unknown>)
        : {};
    const fp = input["file_path"];

    calls.push({
      index: order++,
      name: block.name,
      input,
      filePath: typeof fp === "string" ? fp : undefined,
      timestamp: ev.timestamp,
    });
  }

  return calls;
}

/** Parse a JSONL transcript file and extract its ordered tool calls. */
export async function extractToolCallsFromFile(
  filePath: string,
): Promise<ToolCall[]> {
  const rawEvents = await parseClaudeCodeLog(filePath);
  return extractToolCalls(rawEvents);
}

// ── Tokens-to-completion (measurement-v2 §3.5 co-primary) ────────────

export interface TokenTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** input + output (the co-primary metric; cache reads reported separately) */
  total: number;
}

/**
 * Sum API usage across the transcript's assistant messages. Catches "the
 * served context is huge" — a 30% ETC win at 2x tokens is not a win.
 *
 * The adapter emits several RawDevEvents per assistant message (one per
 * content block) all sharing the same `raw` message object, so usage is
 * deduped by raw-object identity before summing.
 */
export function extractTokenTotals(rawEvents: RawDevEvent[]): TokenTotals {
  const seen = new Set<unknown>();
  const totals: TokenTotals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    total: 0,
  };

  for (const ev of rawEvents) {
    if (seen.has(ev.raw)) continue;
    seen.add(ev.raw);

    const message = (ev.raw as { message?: unknown }).message as
      | { usage?: unknown }
      | undefined;
    const usage = message?.usage as
      | {
          input_tokens?: number;
          output_tokens?: number;
          cache_read_input_tokens?: number;
          cache_creation_input_tokens?: number;
        }
      | undefined;
    if (!usage) continue;

    totals.inputTokens += usage.input_tokens ?? 0;
    totals.outputTokens += usage.output_tokens ?? 0;
    totals.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
    totals.cacheCreationTokens += usage.cache_creation_input_tokens ?? 0;
  }

  totals.total = totals.inputTokens + totals.outputTokens;
  return totals;
}

/** Parse a JSONL transcript file and total its token usage. */
export async function extractTokenTotalsFromFile(
  filePath: string,
): Promise<TokenTotals> {
  const rawEvents = await parseClaudeCodeLog(filePath);
  return extractTokenTotals(rawEvents);
}

// ── File-path glob matching (structural) ─────────────────────────────

const REGEX_META = new Set([
  ".",
  "+",
  "^",
  "$",
  "{",
  "}",
  "(",
  ")",
  "|",
  "[",
  "]",
  "\\",
]);

/**
 * Compile a repo-relative glob into a RegExp (structural parsing only).
 *
 *   `**\/` → zero-or-more directory segments (collapsible)
 *   `**`   → any chars, including `/`
 *   `*`    → any chars except `/`
 *
 * The pattern is anchored so it matches either the whole path or a trailing
 * path segment (transcript file paths are absolute; criteria are
 * repo-relative), e.g. glob `src/mcp/server.ts` matches
 * `/Users/x/repo/src/mcp/server.ts`, and `src/mcp/**\/*.ts` matches both
 * `.../src/mcp/server.ts` and `.../src/mcp/tools/recent.ts`.
 */
export function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          out += "(?:.*/)?"; // **/ collapses to zero or more dirs
          i += 2;
        } else {
          out += ".*"; // bare ** matches anything incl. /
          i += 1;
        }
      } else {
        out += "[^/]*"; // * matches anything except /
      }
    } else if (REGEX_META.has(c)) {
      out += "\\" + c;
    } else {
      out += c;
    }
  }
  // Anchor: full string OR a suffix beginning at a path boundary.
  return new RegExp(`(^|/)${out}$`);
}

/** Does a (possibly absolute) file path match any of the repo-relative globs? */
export function matchesAnyGlob(filePath: string, globs: string[]): boolean {
  if (!filePath) return false;
  const normalized = filePath.replace(/\\/g, "/");
  return globs.some((g) => globToRegExp(g).test(normalized));
}

// ── ETC computation ──────────────────────────────────────────────────

export interface EtcResult {
  /** exploratory tool calls before the first correct edit */
  etc: number;
  /** did the agent ever edit a task-correct file? */
  reachedCorrectEdit: boolean;
  /** index (in the tool-call sequence) of the first correct edit, or -1 */
  firstCorrectEditIndex: number;
  /** total exploratory calls in the whole transcript (for diagnostics) */
  totalExploratory: number;
  /** total tool calls in the transcript */
  totalToolCalls: number;
}

/**
 * Compute ETC: count exploratory tool calls that occur before the first
 * Edit/Write whose file_path matches one of the task's correctFiles.
 *
 * If no correct edit is ever made, `reachedCorrectEdit` is false and `etc`
 * reports all exploratory calls seen (the caller treats a non-reach as a
 * task-success failure — see mvp-eval.ts).
 */
export function computeETC(
  toolCalls: ToolCall[],
  correctFiles: string[],
): EtcResult {
  let exploratoryBefore = 0;
  let totalExploratory = 0;
  let firstCorrectEditIndex = -1;

  for (let i = 0; i < toolCalls.length; i++) {
    const call = toolCalls[i];

    const isExploratory = EXPLORATORY_TOOLS.has(call.name);
    if (isExploratory) totalExploratory++;

    if (firstCorrectEditIndex === -1) {
      const isCorrectEdit =
        EDIT_TOOLS.has(call.name) &&
        !!call.filePath &&
        matchesAnyGlob(call.filePath, correctFiles);

      if (isCorrectEdit) {
        firstCorrectEditIndex = i;
        break;
      }
      if (isExploratory) exploratoryBefore++;
    }
  }

  const reached = firstCorrectEditIndex !== -1;
  return {
    etc: reached ? exploratoryBefore : totalExploratory,
    reachedCorrectEdit: reached,
    firstCorrectEditIndex,
    totalExploratory,
    totalToolCalls: toolCalls.length,
  };
}
