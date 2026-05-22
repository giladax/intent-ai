import { z } from "zod";

// ── Zod Schema ───────────────────────────────────────────────────────

export const SessionShapeSchema = z.object({
  shape: z.enum(["narrative", "exploratory", "janitorial", "debugging", "review"]),
});

export type SessionShape = z.infer<typeof SessionShapeSchema>;

// ── Prompt Input ─────────────────────────────────────────────────────

export interface ClassifyInput {
  /** Total number of events by type */
  eventCounts: Record<string, number>;
  /** List of files touched during the session */
  files: string[];
  /** Sample of user messages (first few, representative) */
  sampleUserMessages: string[];
  /** Total event count */
  totalEvents: number;
}

// ── Prompt Builder ───────────────────────────────────────────────────

export function buildClassifyPrompt(input: ClassifyInput): {
  system: string;
  user: string;
} {
  const system = `You are a development session classifier. You analyze a summary of a developer's coding session and classify it into one of five shapes.

Session shapes:

1. **narrative** — The session tells a story of building something. There is a clear arc: the developer starts with an intent, works through implementation, and arrives at a result. Characterized by a mix of intent, action, and reflection events. The developer is driving toward a goal.

2. **exploratory** — The session is about understanding, investigating, or experimenting. The developer is reading code, searching, asking questions, trying things out. Lots of reflection events, Read/Grep/Glob tool calls. No clear build arc — more like research.

3. **janitorial** — The session is maintenance work: renaming, reformatting, dependency updates, config changes, CI fixes. Lots of small edits across many files. Low cognitive load, high file count. The changes are mechanical rather than creative.

4. **debugging** — The session is dominated by a bug hunt. Characterized by cycles of: hypothesis → test → observe → adjust. Lots of Bash runs, error output in tool results, repeated edits to the same files. The developer is reacting to failures.

5. **review** — The session is primarily about reviewing code, reading diffs, or evaluating existing work. Mostly reading and reflection, with few or no edits. The developer is assessing rather than building.

Respond with ONLY a JSON object: { "shape": "<one of the five shapes>" }`;

  const user = `Here is a summary of the development session:

**Event counts:**
${Object.entries(input.eventCounts)
  .map(([type, count]) => `- ${type}: ${count}`)
  .join("\n")}

**Total events:** ${input.totalEvents}

**Files touched (${input.files.length} total):**
${input.files.slice(0, 30).join("\n")}${input.files.length > 30 ? `\n... and ${input.files.length - 30} more` : ""}

**Sample user messages:**
${input.sampleUserMessages
  .slice(0, 8)
  .map((msg, i) => `${i + 1}. ${msg}`)
  .join("\n")}

Classify this session. Return JSON only.`;

  return { system, user };
}
