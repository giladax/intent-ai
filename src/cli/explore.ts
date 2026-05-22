import type { Command } from "commander";
import * as readline from "node:readline";
import Anthropic from "@anthropic-ai/sdk";
import {
  getMostRecentSession,
  getSessionNarrative,
  getSessionMoments,
  getSessionTransitions,
  getSessionOutcomes,
  getChunkEvents,
} from "../storage/queries.js";
import type {
  SessionNarrative,
  SessionMoment,
  IntentTransition,
  AcceptedOutcome,
  NormalizedDevEvent,
} from "../adapters/types.js";

// ── Types ───────────────────────────────────────────────────────────

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export interface SessionDigest {
  sessionId: string;
  narrative: SessionNarrative;
  moments: SessionMoment[];
  transitions: IntentTransition[];
  outcomes: AcceptedOutcome[];
}

// ── Constants ───────────────────────────────────────────────────────

const MAX_HISTORY_EXCHANGES = 10;
const SONNET_MODEL = "claude-sonnet-4-6";

// ── CLI Registration ────────────────────────────────────────────────

export function registerExploreCommand(program: Command): void {
  program
    .command("explore")
    .description("Explore digested sessions interactively")
    .option("--session <id>", "Explore a specific session by ID")
    .action(async (opts: { session?: string }) => {
      try {
        await runExplore(opts.session);
      } catch (err) {
        console.error(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
    });
}

// ── Main Entry Point ────────────────────────────────────────────────

async function runExplore(sessionId?: string): Promise<void> {
  // Resolve session
  const session = await resolveSession(sessionId);

  // Load digest
  const digest = await loadDigest(session.id);

  // Print header
  const startStr = session.startedAt
    ? formatTime(session.startedAt)
    : "unknown";
  const endStr = session.endedAt ? formatTime(session.endedAt) : "unknown";
  console.log(`intent explore v1.0`);
  console.log(
    `Session: ${startStr} → ${endStr} (${digest.narrative.sessionShape})`,
  );
  console.log(
    `${digest.moments.length} moments, ${digest.transitions.length} transitions, ${digest.narrative.arcs.length} arcs loaded.`,
  );
  console.log();

  // Build system prompt
  const systemPrompt = buildSystemPrompt(digest);

  // Start REPL
  await startRepl(systemPrompt, digest);
}

// ── Session Resolution ──────────────────────────────────────────────

async function resolveSession(
  sessionId?: string,
): Promise<{ id: string; startedAt: Date | null; endedAt: Date | null }> {
  if (sessionId) {
    // Verify session exists by loading its narrative
    const narrative = await getSessionNarrative(sessionId);
    if (!narrative) {
      throw new Error(
        `Session ${sessionId} not found or has no digest. Run \`intent digest\` first.`,
      );
    }
    return { id: sessionId, startedAt: null, endedAt: null };
  }

  const mostRecent = await getMostRecentSession();
  if (!mostRecent) {
    throw new Error(
      "No digested sessions found. Run `intent digest` first.",
    );
  }
  return {
    id: mostRecent.id,
    startedAt: mostRecent.startedAt,
    endedAt: mostRecent.endedAt,
  };
}

// ── Digest Loading ──────────────────────────────────────────────────

export async function loadDigest(sessionId: string): Promise<SessionDigest> {
  const [narrative, moments, transitions, outcomes] = await Promise.all([
    getSessionNarrative(sessionId),
    getSessionMoments(sessionId),
    getSessionTransitions(sessionId),
    getSessionOutcomes(sessionId),
  ]);

  if (!narrative) {
    throw new Error(
      `Session ${sessionId} has no narrative. The digest may be incomplete.`,
    );
  }

  if (moments.length === 0) {
    console.warn(
      "Warning: Session found but no moments detected. The digest may be incomplete.",
    );
  }

  return { sessionId, narrative, moments, transitions, outcomes };
}

// ── System Prompt ───────────────────────────────────────────────────

export function buildSystemPrompt(digest: SessionDigest): string {
  const { narrative, moments, transitions, outcomes } = digest;

  const arcSection = narrative.arcs
    .map(
      (arc) =>
        `- **${arc.title}** (${arc.resolution}): ${arc.summary}`,
    )
    .join("\n");

  const momentSection = moments
    .map((m, i) => {
      const evidenceQuotes = m.evidence
        .map((e) => `  - [${e.sourceType}] "${e.quote}"`)
        .join("\n");
      return `${i + 1}. [${m.type}] ${m.statement}\n   Agency: ${m.agency} | Significance: ${m.significance} | Confidence: ${m.confidence}\n   Topic: ${m.topicFingerprint}\n${evidenceQuotes}`;
    })
    .join("\n\n");

  const transitionSection = transitions
    .map(
      (t) => `- "${t.fromStatement}" → "${t.toStatement}"\n  Reason: ${t.reason}`,
    )
    .join("\n");

  const outcomeSection = outcomes
    .map(
      (o) =>
        `- ${o.statement}${o.supportingFiles.length > 0 ? `\n  Files: ${o.supportingFiles.join(", ")}` : ""}`,
    )
    .join("\n");

  return `You are an execution memory assistant. You have access to a detailed digest of a developer's coding session. Answer questions about what happened, why decisions were made, who drove which decisions, and how understanding evolved.

## Session Digest

### Summary
${narrative.summary}

### Arcs (${narrative.arcs.length})
${arcSection || "None"}

### Moments (${moments.length} total)
${momentSection || "None"}

### Transitions (${transitions.length})
${transitionSection || "None"}

### Outcomes (${outcomes.length})
${outcomeSection || "None"}

## Rules
- Answer based on the evidence in the digest. Don't speculate beyond what the data shows.
- When attributing decisions, use the agency field (developer vs ai vs collaborative).
- Quote the developer's actual words when available (from evidence).
- If asked about something not covered by the digest, say so.
- If the user asks to "show me" or "drill into" a specific moment, you'll receive the raw events in a follow-up.
- Keep responses concise but thorough. Use evidence to support your points.`;
}

// ── Drill-down ──────────────────────────────────────────────────────

export function findMatchingMoment(
  query: string,
  moments: SessionMoment[],
): SessionMoment | null {
  const lower = query.toLowerCase();

  // Try matching by statement content or topicFingerprint
  const matches = moments.filter(
    (m) =>
      m.statement.toLowerCase().includes(lower) ||
      m.topicFingerprint.toLowerCase().includes(lower),
  );

  if (matches.length === 1) return matches[0];

  // If multiple matches, prefer the one with the strongest keyword overlap
  if (matches.length > 1) {
    const words = lower.split(/\s+/).filter((w) => w.length > 2);
    let best: SessionMoment | null = null;
    let bestScore = 0;
    for (const m of matches) {
      const text = `${m.statement} ${m.topicFingerprint}`.toLowerCase();
      const score = words.filter((w) => text.includes(w)).length;
      if (score > bestScore) {
        bestScore = score;
        best = m;
      }
    }
    return best;
  }

  // Fallback: check individual words from the query
  const words = lower.split(/\s+/).filter((w) => w.length > 3);
  if (words.length === 0) return null;

  let best: SessionMoment | null = null;
  let bestScore = 0;
  for (const m of moments) {
    const text = `${m.statement} ${m.topicFingerprint}`.toLowerCase();
    const score = words.filter((w) => text.includes(w)).length;
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }

  return bestScore > 0 ? best : null;
}

function isDrillDownRequest(input: string): boolean {
  const drillPatterns = [
    /show me/i,
    /drill (into|down)/i,
    /tell me more/i,
    /more detail/i,
    /full exchange/i,
    /raw events/i,
    /what happened around/i,
  ];
  return drillPatterns.some((p) => p.test(input));
}

async function loadDrillDownContext(
  input: string,
  digest: SessionDigest,
): Promise<string | null> {
  if (!isDrillDownRequest(input)) return null;

  const moment = findMatchingMoment(input, digest.moments);
  if (!moment || !moment.chunkId) return null;

  console.log(
    `[Loading chunk events for moment: "${moment.statement.slice(0, 60)}..."]`,
  );

  const events = await getChunkEvents(digest.sessionId, moment.chunkId);
  if (events.length === 0) return null;

  const eventLines = events
    .map(
      (e) =>
        `[${e.causalOrder}] ${e.actor.toUpperCase()}: ${e.content.summary}${e.content.detail ? `\n         ${e.content.detail.slice(0, 200)}` : ""}`,
    )
    .join("\n");

  return `\n\n## Detailed Events for Moment: "${moment.statement}"
Type: ${moment.type} | Agency: ${moment.agency}

${eventLines}`;
}

// ── REPL ────────────────────────────────────────────────────────────

async function startRepl(
  systemPrompt: string,
  digest: SessionDigest,
): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Export it in your environment or add it to .env",
    );
  }
  const client = new Anthropic({ apiKey });

  const history: ConversationMessage[] = [];

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> ",
  });

  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    if (input === "exit" || input === "quit" || input === ".exit") {
      rl.close();
      return;
    }

    try {
      // Check for drill-down and augment user message if needed
      const drillContext = await loadDrillDownContext(input, digest);
      const userContent = drillContext
        ? `${input}\n${drillContext}`
        : input;

      // Add user message
      history.push({ role: "user", content: userContent });

      // Trim history to last N exchanges
      while (history.length > MAX_HISTORY_EXCHANGES * 2) {
        history.shift();
      }

      // Call LLM
      const response = await client.messages.create({
        model: SONNET_MODEL,
        max_tokens: 4096,
        temperature: 0,
        system: systemPrompt,
        messages: history.map((m) => ({ role: m.role, content: m.content })),
      });

      const textBlock = response.content.find((b) => b.type === "text");
      const assistantText = textBlock && textBlock.type === "text"
        ? textBlock.text
        : "(No response)";

      // Add assistant message to history
      history.push({ role: "assistant", content: assistantText });

      console.log();
      console.log(assistantText);
      console.log();
    } catch (err) {
      console.error(
        `\nError: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }

    rl.prompt();
  });

  rl.on("close", () => {
    console.log("\nGoodbye.");
    process.exit(0);
  });
}

// ── Helpers ─────────────────────────────────────────────────────────

function formatTime(date: Date): string {
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
