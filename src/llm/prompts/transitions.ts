import { z } from "zod";
import type { Pass2Moment } from "./moments.js";
import type { SessionShape } from "./classify.js";

// ── Zod Schemas ──────────────────────────────────────────────────────

const IntentTransitionSchema = z.object({
  fromStatement: z.string().optional().default(""),
  toStatement: z.string().optional().default(""),
  from: z.string().optional(), // alternative field name LLMs sometimes use
  to: z.string().optional(),
  reason: z.string().optional().default(""),
  triggeringMomentIndices: z.array(z.number()).optional().default([]),
  momentIndices: z.array(z.number()).optional(), // alternative name
  arcId: z.string().optional().default("general"),
  confidence: z.enum(["high", "medium", "low"]).optional().default("medium"),
}).transform((t) => ({
  fromStatement: t.fromStatement || t.from || "",
  toStatement: t.toStatement || t.to || "",
  reason: t.reason,
  triggeringMomentIndices: t.triggeringMomentIndices.length > 0 ? t.triggeringMomentIndices : (t.momentIndices ?? []),
  arcId: t.arcId,
  confidence: t.confidence,
}));

const AcceptedOutcomeSchema = z.object({
  statement: z.string(),
  supportingMomentIndices: z.array(z.number()).optional().default([]),
  momentIndices: z.array(z.number()).optional(), // alternative name
  filesAffected: z.array(z.string()).optional().default([]),
  files: z.array(z.string()).optional(), // alternative name
  confidence: z.enum(["high", "medium", "low"]).optional().default("medium"),
}).transform((o) => ({
  statement: o.statement,
  supportingMomentIndices: o.supportingMomentIndices.length > 0 ? o.supportingMomentIndices : (o.momentIndices ?? []),
  filesAffected: o.filesAffected.length > 0 ? o.filesAffected : (o.files ?? []),
  confidence: o.confidence,
}));

export const TransitionsOutputSchema = z.object({
  transitions: z.array(IntentTransitionSchema),
  outcomes: z.array(AcceptedOutcomeSchema),
});

export type IntentTransition = z.infer<typeof IntentTransitionSchema>;
export type AcceptedOutcome = z.infer<typeof AcceptedOutcomeSchema>;
export type TransitionsOutput = z.infer<typeof TransitionsOutputSchema>;

// ── Prompt Input ─────────────────────────────────────────────────────

export interface TransitionsInput {
  moments: Pass2Moment[];
  sessionShape: SessionShape;
  filesInSession: string[];
}

// ── Prompt Builder ───────────────────────────────────────────────────

export function buildTransitionsPrompt(input: TransitionsInput): {
  system: string;
  user: string;
} {
  const { moments, sessionShape, filesInSession } = input;

  const system = `You are an expert at identifying intent transitions and accepted outcomes in developer coding sessions.

You receive the final set of moments from a session and must extract two things:

## 1. Intent Transitions

An intent transition is when the developer's working intent shifted. NOT every moment is a transition — only the points where what-the-developer-is-trying-to-do actually changed.

Examples:
- "Implement auth middleware" → "Debug auth middleware CORS issue" (triggered by a discovery that CORS headers were missing)
- "Add unit tests for parser" → "Refactor parser to be testable" (triggered by realizing the parser was too coupled)
- "Explore caching options" → "Implement Redis caching layer" (triggered by a commitment to use Redis)

Each transition must cite which moments triggered it (by index into the moments array).

Only flag genuine shifts. If the developer stayed focused on one thing the whole time, return an empty transitions array.

## 2. Accepted Outcomes

An accepted outcome is something the developer produced and accepted during the session. This is NOT just "files were edited" — it's "the developer reached a state they considered done (or at least good enough) for this piece."

Indicators of acceptance:
- Tests passing after implementation
- Developer explicitly saying "that looks good" or moving on to the next thing
- A commit being made
- No further edits to a file/feature after implementation

Each outcome should:
- State what was accomplished in the developer's terms
- List the specific files affected
- Reference supporting moments

If the session was purely exploratory with no concrete outputs, return an empty outcomes array.

Respond with ONLY a JSON object: { "transitions": [...], "outcomes": [...] }`;

  const user = `## Session Shape: ${sessionShape.shape}

## Moments (${moments.length} total):

${moments
  .map(
    (m, i) => `${i}. [${m.type}] (arc: ${m.arcId}, role: ${m.arcRole}) ${m.statement}
   agency=${m.agency} confidence=${m.confidence}
   topic=${m.topicFingerprint}
   evidence: ${m.evidence.map((e) => `"${e.quote.slice(0, 100)}"`).join("; ")}`,
  )
  .join("\n\n")}

## Files touched in session (${filesInSession.length} total):
${filesInSession.slice(0, 40).join("\n")}${filesInSession.length > 40 ? `\n... and ${filesInSession.length - 40} more` : ""}

Identify intent transitions and accepted outcomes. Return JSON only.`;

  return { system, user };
}
