import { z } from "zod";
import type { NormalizedDevEvent, SessionChunk, PipelineDirectives } from "../../adapters/types.js";
import type { SessionShape } from "./classify.js";
import type { SessionDigest } from "../../pipeline/session-digest.js";
import type { DedupResult } from "../../pipeline/dedup-moments.js";

// ── Zod Schemas ──────────────────────────────────────────────────────

const MomentTypeSchema = z.enum([
  "proposal",
  "discovery",
  "pivot",
  "confirmation",
  "rejection",
  "commitment",
  "struggle",
  "breakthrough",
  "execution",
]);

const EvidenceSchema = z.object({
  quote: z.string(),
  sourceEventId: z.string().optional(),
  sourceType: z.enum(["user", "ai", "tool_output"]).optional().default("ai"),
  quoteType: z.enum(["verbatim", "paraphrase"]).optional().default("verbatim"),
});

// Accept evidence as either structured objects or plain strings
const FlexibleEvidenceSchema = z.union([
  EvidenceSchema,
  z.string().transform((s) => ({ quote: s, sourceType: "ai" as const, quoteType: "verbatim" as const })),
]);

const Pass1MomentSchema = z.object({
  type: MomentTypeSchema,
  statement: z.string(),
  significance: z.string(), // why this moment matters — free text
  agency: z.enum(["developer", "ai", "collaborative"]),
  confidence: z.enum(["high", "medium", "low"]),
  topicFingerprint: z.string().optional().default("general"),
  evidence: z.union([
    z.array(FlexibleEvidenceSchema).min(1),
    z.string().transform((s) => [{ quote: s, sourceType: "ai" as const, quoteType: "verbatim" as const }]),
  ]).optional().default([{ quote: "no evidence provided", sourceType: "ai" as const, quoteType: "paraphrase" as const }]),
});

export const Pass1OutputSchema = z.object({
  moments: z.array(Pass1MomentSchema),
});

const Pass2MomentSchema = Pass1MomentSchema.passthrough().extend({
  arcId: z.string().optional().default("general"),
  arcRole: z.enum(["origin", "development", "turning_point", "resolution"]).optional().default("development"),
  relatedMomentIds: z.array(z.number()).optional().default([]),
});

export const Pass2OutputSchema = z.object({
  moments: z.array(Pass2MomentSchema),
});

export type Pass1Moment = z.infer<typeof Pass1MomentSchema>;
export type Pass1Output = z.infer<typeof Pass1OutputSchema>;
export type Pass2Moment = z.infer<typeof Pass2MomentSchema>;
export type Pass2Output = z.infer<typeof Pass2OutputSchema>;

// ── Pass 1: Per-Chunk Moment Detection ───────────────────────────────

export interface Pass1Input {
  chunk: SessionChunk;
  sessionShape: SessionShape;
  directives?: PipelineDirectives;
  digest?: SessionDigest;
  totalChunks?: number;
}

export function buildPass1Prompt(input: Pass1Input): {
  system: string;
  user: string;
} {
  const { chunk, sessionShape, directives, digest, totalChunks } = input;

  let directiveGuidance = "";
  if (directives?.promptSections) {
    const sections = directives.promptSections;
    const notes: string[] = [];

    if (sections.detectPassiveAcceptance) {
      notes.push(
        "Note: This session contains many short developer responses. When you see 'yes', 'ok', 'sure' — distinguish active agreement from passive acceptance. This matters for agency classification.",
      );
    }
    if (sections.trackDelegation) {
      notes.push(
        "Note: The developer frequently defers decisions. Look for moments where the AI made choices the developer didn't engage with.",
      );
    }
    if (sections.detectIgnoredProposals) {
      notes.push(
        "Note: The AI made proposals that the developer didn't fully address. Flag proposals that received no direct response as potential ignored proposals.",
      );
    }
    if (sections.isLearningExchange) {
      notes.push(
        "Note: The developer is asking questions to understand. Focus on what insights or understanding emerged, not just what actions were taken.",
      );
    }

    if (notes.length > 0) {
      directiveGuidance = "\n\n## Interaction Signals\n\n" + notes.join("\n\n");
    }
  }

  const system = `You are an expert at identifying meaningful moments in developer coding sessions. You read a sequence of events from one chunk of a session and extract the moments that matter.

A "moment" is a point where something meaningful happened — a decision was made, an insight occurred, direction changed, or a commitment was established. NOT every event is a moment. You are looking for the inflection points.

## Moment Types

- **proposal** — Someone (developer or AI) suggests an approach, architecture, or solution. Use the proposer's actual words.
- **discovery** — New information surfaces that changes understanding. "Oh, this API doesn't support streaming" or "The tests are actually passing, it was a caching issue."
- **pivot** — Direction changes. The developer was doing X, now they're doing Y. Must cite what triggered the pivot.
- **confirmation** — A tentative approach becomes accepted. "Yeah, that looks right" or running tests that pass.
- **rejection** — An approach is explicitly rejected. "Actually let's not mock the database" or reverting a change.
- **commitment** — A firm decision that shapes subsequent work. Different from confirmation — this is choosing a path, not validating one.
- **struggle** — Repeated failed attempts, confusion, or difficulty. Cycles of edit-fail-edit on the same problem.
- **breakthrough** — A struggle resolves. The thing that wasn't working now works, or the confusion clears.
- **execution** — Sustained implementation of an already-decided approach. Only flag this for significant scope, not every edit.

## Rules

1. **Be specific, not generic.** "Developer rejected AI's suggestion to use a mock database, saying 'actually let's not mock the database, let's use testcontainers'" — not "a decision was made about testing."
2. **Use the developer's own language.** Quote them. If the AI proposed something and the developer accepted, say what the AI proposed AND how the developer responded.
3. **Every moment MUST have evidence.** At least one direct quote from the events.
4. **Distinguish agency clearly.** Who drove this moment? "developer" if they initiated it. "ai" if the AI proposed it and the developer just went along. "collaborative" if there was back-and-forth.
5. **topicFingerprint** should be a short, stable identifier for the topic area (e.g., "auth-middleware", "test-setup", "api-schema"). Use kebab-case. Two moments about the same topic should share a fingerprint.
6. **Fewer is better.** A chunk of 20 events might have 2-5 moments. Don't pad. If nothing meaningful happened, return an empty array.

${getShapeGuidance(sessionShape.shape)}${directiveGuidance}

## Output Format

Return ONLY a JSON object:
{
  "moments": [
    {
      "type": "proposal|discovery|pivot|confirmation|rejection|commitment|struggle|breakthrough|execution",
      "statement": "What happened, in the developer's own language",
      "significance": "Why this moment matters in the context of the session",
      "agency": "developer|ai|collaborative",
      "confidence": "high|medium|low",
      "topicFingerprint": "kebab-case-topic-id",
      "evidence": [
        {
          "quote": "Exact or near-exact quote from the events",
          "sourceEventId": "the [N] event index as a string",
          "sourceType": "user|ai|tool_output",
          "quoteType": "verbatim|paraphrase"
        }
      ]
    }
  ]
}`;

  const contextHeader = digest && totalChunks
    ? buildContextHeader(chunk.chunkIndex, totalChunks, digest)
    : "";

  const user = `## Session Shape: ${sessionShape.shape}
## Chunk ${chunk.chunkIndex} — Topic: ${chunk.topicHint}
## Files in scope: ${chunk.filesInScope.slice(0, 15).join(", ")}
${contextHeader}
## Events (${chunk.events.length} total):

${formatThreadedEvents(chunk.events)}

Extract the meaningful moments from this chunk. Return JSON only.`;

  return { system, user };
}

// ── Pass 2: Cross-Chunk Merge & Arc Assignment ───────────────────────

export interface Pass2Input {
  pass1Moments: { chunkIndex: number; moments: Pass1Moment[] }[];
  sessionShape: SessionShape;
  totalChunks: number;
  dedupResult?: DedupResult;
}

export function buildPass2Prompt(input: Pass2Input): {
  system: string;
  user: string;
} {
  const { pass1Moments, sessionShape, totalChunks, dedupResult } = input;

  const system = `You are an expert at synthesizing developer session moments into coherent arcs. You receive moments detected across multiple chunks of a single session and must:

1. **Deduplicate** — If the same moment was detected in overlapping chunks, keep the best version (more specific statement, stronger evidence).
2. **Merge** — If two moments describe the same underlying event from different perspectives, merge them into one.
3. **Assign arcs** — Group related moments into narrative arcs. An arc is a thread of related activity (e.g., "setting up auth middleware" or "debugging the flaky test"). Give each arc a short kebab-case ID.
4. **Assign arc roles** — Within each arc, mark each moment's role:
   - **origin** — The moment that started this arc (first proposal, initial discovery)
   - **development** — Moments that advance the arc (execution, further proposals)
   - **turning_point** — Pivots, rejections, breakthroughs that change the arc's direction
   - **resolution** — The arc reaches a conclusion (commitment, final confirmation)
5. **Link related moments** — If moment N was caused by or responds to moment M, include M's index in relatedMomentIds. Use 0-based indices into YOUR output array.

## Rules

- Preserve the developer's own language in statements. Don't rewrite to be more "professional."
- If a moment from Pass 1 is low quality (vague statement, no real evidence), drop it.
- Don't invent moments that weren't in Pass 1. You can only merge, dedupe, enrich, or drop.
- An arc can have 1 moment (a standalone insight) or many (a full narrative thread).
- Total output moments should be <= total input moments.

Respond with ONLY a JSON object: { "moments": [...] }`;

  const user = `## Session Shape: ${sessionShape.shape}
## Total chunks: ${totalChunks}

## Pass 1 Moments by Chunk:

${pass1Moments
  .map(
    ({ chunkIndex, moments }) => `### Chunk ${chunkIndex} (${moments.length} moments):
${moments
  .map(
    (m, i) => `  ${i}. [${m.type}] ${m.statement}
     significance=${m.significance} agency=${m.agency} confidence=${m.confidence}
     topic=${m.topicFingerprint}
     evidence: ${m.evidence.map((e) => `"${e.quote.slice(0, 120)}"`).join("; ")}`,
  )
  .join("\n")}`,
  )
  .join("\n\n")}

${buildDedupSection(dedupResult)}
Synthesize these into final moments with arc assignments. Return JSON only.`;

  return { system, user };
}

// ── Dedup Section Builder ─────────────────────────────────────────────

/**
 * Build a section for pass 2 that summarizes dedup actions already taken
 * and flags remaining issues for the LLM to resolve.
 */
function buildDedupSection(dedupResult?: DedupResult): string {
  if (!dedupResult) return "";

  const sections: string[] = [];

  // Duplicates already removed
  if (dedupResult.removed.length > 0) {
    sections.push(
      `## Pre-filter: Duplicates Removed (${dedupResult.removed.length})\n` +
      dedupResult.removed
        .slice(0, 10) // cap output
        .map((r) => `- Chunk ${r.chunkIndex}: [${r.moment.type}] "${r.moment.statement.slice(0, 80)}" — ${r.reason}`)
        .join("\n"),
    );
  }

  // Contradictions to resolve
  if (dedupResult.contradictions.length > 0) {
    sections.push(
      `## Contradictions to Resolve\nThese events were cited with different agency across chunks. Determine the correct agency:\n` +
      dedupResult.contradictions
        .map(
          (c) =>
            `- Event ${c.eventId}: ${c.entries.map((e) => `chunk ${e.chunkIndex}=${e.agency}`).join(" vs ")}`,
        )
        .join("\n"),
    );
  }

  // Boundary merges to consider
  if (dedupResult.boundaryMerges.length > 0) {
    sections.push(
      `## Boundary Exchanges\nThese moments span chunk boundaries with the same topic — consider merging:\n` +
      dedupResult.boundaryMerges
        .map(
          (b) =>
            `- Topic "${b.topicFingerprint}": chunks ${b.chunkA}-${b.chunkB}`,
        )
        .join("\n"),
    );
  }

  return sections.length > 0 ? "\n" + sections.join("\n\n") + "\n" : "";
}

// ── Context Header Builder ────────────────────────────────────────────

/**
 * Build a compact cross-chunk context header for pass 1 prompts.
 * Target: 200-400 tokens. Gives the LLM awareness of where this chunk
 * sits in the session without overwhelming.
 */
function buildContextHeader(
  chunkIndex: number,
  totalChunks: number,
  digest: SessionDigest,
): string {
  const lines: string[] = [];
  lines.push(`\n## Session Context (Chunk ${chunkIndex} of ${totalChunks - 1})`);

  // Prior topics — summarize chunks before this one
  const priorTopics = digest.topicFlow
    .filter((t) => t.chunkIndex < chunkIndex)
    .map((t) => `Chunk ${t.chunkIndex}: ${t.topicHint}`)
    .slice(-5); // last 5 max

  if (priorTopics.length > 0) {
    lines.push(`Prior topics: ${priorTopics.join(", ")}`);
  }

  // Key developer statements from prior chunks (most recent 5)
  const priorStatements = digest.developerStatements
    .filter((s) => s.chunkIndex < chunkIndex)
    .slice(-5)
    .map((s) => {
      const truncated = s.text.length > 80 ? s.text.slice(0, 80) + "..." : s.text;
      return `[${s.causalOrder}] "${truncated}"`;
    });

  if (priorStatements.length > 0) {
    lines.push(`Key developer statements: ${priorStatements.join(", ")}`);
  }

  // Boundary exchanges involving this chunk
  const boundaries = digest.boundaryExchanges.filter(
    (b) => b.chunkA === chunkIndex || b.chunkB === chunkIndex,
  );
  if (boundaries.length > 0) {
    const boundaryNotes = boundaries.map(
      (b) => `Exchange spanning chunks ${b.chunkA}-${b.chunkB}`,
    );
    lines.push(`Boundary: ${boundaryNotes.join("; ")}`);
  }

  return lines.join("\n");
}

// ── Helpers ──────────────────────────────────────────────────────────

function getShapeGuidance(shape: string): string {
  switch (shape) {
    case "janitorial":
      return `## Shape-specific guidance (janitorial session)
Focus on SCOPE moments — what got included, what got excluded, any scope creep. In janitorial sessions, the interesting moments are:
- When the developer decided what to clean up (commitment)
- When they discovered unexpected issues during cleanup (discovery)
- When cleanup scope expanded or contracted (pivot)
- When mechanical work revealed a deeper problem (breakthrough/discovery)
Don't flag every rename or format change as a moment. Look for the decisions, not the keystrokes.`;

    case "exploratory":
      return `## Shape-specific guidance (exploratory session)
Focus on INSIGHT moments — what the developer learned, what changed their understanding. In exploratory sessions:
- Key discoveries about how code works or doesn't work
- Moments where investigation direction changed (pivot)
- "Aha" moments where confusion cleared (breakthrough)
- Decisions about what to investigate next (commitment)
Don't flag every file read as a moment. Look for what the developer understood differently after reading.`;

    case "debugging":
      return `## Shape-specific guidance (debugging session)
Focus on the HYPOTHESIS-TEST cycle. In debugging sessions:
- Initial hypothesis about the bug (proposal)
- Evidence that confirmed or rejected the hypothesis (confirmation/rejection)
- The actual root cause discovery (breakthrough)
- Failed attempts that narrowed the search (struggle → discovery)
Track the chain of reasoning, not every individual Bash run.`;

    case "narrative":
      return `## Shape-specific guidance (narrative session)
This session has a build arc. Focus on:
- The initial intent and how it evolved
- Key architectural decisions (commitment)
- Moments where the plan changed (pivot)
- AI proposals that were accepted vs rejected
- The progression from intent to working code`;

    case "review":
      return `## Shape-specific guidance (review session)
Focus on ASSESSMENT moments:
- Observations about code quality or correctness (discovery)
- Decisions about what to flag or change (commitment)
- Surprising findings (discovery/breakthrough)
Don't flag every file read. Look for judgments and insights.`;

    default:
      return "";
  }
}

/**
 * Format events grouped by exchange (user intent + following AI events).
 * Events not part of any exchange render as standalone.
 */
function formatThreadedEvents(events: NormalizedDevEvent[]): string {
  // Find all intent (user message) indices
  const intentIndices: number[] = [];
  for (let i = 0; i < events.length; i++) {
    if (events[i].category === "intent") {
      intentIndices.push(i);
    }
  }

  // If no intents, fall back to flat format
  if (intentIndices.length === 0) {
    return formatEventsFlat(events);
  }

  const blocks: string[] = [];

  // Events before the first intent (standalone)
  if (intentIndices[0] > 0) {
    const standalone = events.slice(0, intentIndices[0]);
    blocks.push(formatEventsFlat(standalone));
  }

  // Each exchange: intent + following AI events until next intent
  for (let k = 0; k < intentIndices.length; k++) {
    const devIdx = intentIndices[k];
    const nextIntentIdx =
      k + 1 < intentIndices.length ? intentIndices[k + 1] : events.length;

    const devEvent = events[devIdx];
    const aiEvents = events.slice(devIdx + 1, nextIntentIdx);

    const devDetail = truncateDetail(devEvent.content.detail, TRUNCATION_LIMITS.intent);

    let block = `── Exchange ──\n[${devEvent.causalOrder}] DEV: "${devDetail}"`;

    if (aiEvents.length > 0) {
      block += "\n  AI:";
      for (const ae of aiEvents) {
        block += `\n    - ${formatAiEvent(ae)}`;
      }
    }

    blocks.push(block);
  }

  return blocks.join("\n\n");
}

function formatAiEvent(e: NormalizedDevEvent): string {
  const files = e.content.filesAffected ?? [];
  const limit = TRUNCATION_LIMITS[e.category as keyof typeof TRUNCATION_LIMITS] ?? 400;
  const detail = truncateDetail(e.content.detail, limit);

  switch (e.category) {
    case "proposal":
    case "reflection":
      return `[${e.causalOrder}] "${detail}"`;
    case "action": {
      const toolMatch = e.content.summary.match(/^Tool:\s+(\S+)/);
      const toolName = toolMatch?.[1] ?? "Action";
      if (files.length > 0) {
        return `[${e.causalOrder}] ${toolName} ${files[0]}`;
      }
      return `[${e.causalOrder}] ${toolName}`;
    }
    case "result":
      return `[${e.causalOrder}] Result: ${truncateDetail(e.content.summary, TRUNCATION_LIMITS.result)}`;
    default:
      return `[${e.causalOrder}] ${detail}`;
  }
}

function formatEventsFlat(events: NormalizedDevEvent[]): string {
  return events
    .map((e) => {
      const actor = e.actor === "user" ? "DEV" : "AI";
      const category = e.category.toUpperCase();
      const files = e.content.filesAffected?.length
        ? ` [${e.content.filesAffected.join(", ")}]`
        : "";
      const detail = truncateDetail(e.content.detail);
      return `[${e.causalOrder}] ${actor}/${category}${files}: ${detail}`;
    })
    .join("\n\n");
}

function truncateDetail(text: string, maxChars: number = 400): string {
  return text.length > maxChars ? text.slice(0, maxChars) + "..." : text;
}

// Longer limits for signal-rich content, shorter for noise
const TRUNCATION_LIMITS = {
  intent: 800,      // developer messages — the core signal
  proposal: 800,    // AI proposals — carry decision content
  reflection: 600,  // AI reasoning after tool results
  action: 200,      // tool calls — name + path is enough
  result: 200,      // tool results — mostly file contents (noise)
} as const;
