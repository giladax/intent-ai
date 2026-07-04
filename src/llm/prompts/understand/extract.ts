import { z } from "zod";
import type { SessionChunk, PipelineDirectives } from "../../../adapters/types.js";

// ── Zod Schemas ───────────────────────────────────────────────────────

export const ExtractEvidenceSchema = z.object({
  quote: z.string().min(1),
  eventIndex: z.union([
    z.number(),
    z.string().transform((s) => {
      const n = parseInt(s, 10);
      return Number.isNaN(n) ? null : n;
    }),
  ]).nullable(),
  sourceType: z.enum(["user", "ai", "tool_output"]).optional().default("ai"),
});

export const ExtractMomentSchema = z.object({
  type: z.enum([
    "proposal",
    "discovery",
    "pivot",
    "confirmation",
    "rejection",
    "commitment",
    "struggle",
    "breakthrough",
    "execution",
  ]),
  statement: z.string().min(1),
  significance: z.string().optional().default(""),
  agency: z.enum(["developer", "ai", "collaborative"]),
  confidence: z.enum(["high", "medium", "low"]).nullable().optional().transform(
    (v) => v ?? null,
  ),
  topicFingerprint: z.string().optional().default("general"),
  evidence: z.array(ExtractEvidenceSchema).min(1), // REQUIRED — no default, no fabrication
});

export const ExtractOutputSchema = z.object({
  moments: z.array(ExtractMomentSchema),
});

// ── Shape Guidance (copied from moments.ts — do not import from there) ──

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

// ── Prompt Builder ─────────────────────────────────────────────────────

export function buildExtractPrompt(input: {
  chunk: SessionChunk;
  sessionShape: string;
  directives?: PipelineDirectives;
  digestHeader?: string;
}): { system: string; user: string } {
  const { chunk, sessionShape, directives, digestHeader } = input;

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
7. **Opening intent is a moment.** If this is chunk 0, the developer's first substantive message states what they came to do — extract it (usually "commitment" or "proposal", agency "developer").
8. **Cite the event index.** Every evidence item includes "eventIndex": the [N] number shown on the event you are quoting. Quotes must come from the events shown — never from memory.

## Confidence Rubric

- **high** — direct quote or tool result in provided events explicitly supports the moment
- **medium** — inferred from multiple events, never explicitly stated
- **low** — weak or indirect support
- **omit / null** — if the moment is undecidable, omit confidence or set it to null

## Agency Rubric

Agency is about who SET THE DIRECTION, not who typed. Executing tools is NOT agency.
- **developer** — the developer initiated or drove this moment
- **ai** — the AI proposed it and the developer passively accepted (went along without meaningful engagement)
- **collaborative** — genuine back-and-forth shaped the outcome

${getShapeGuidance(sessionShape)}${directiveGuidance}

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
          "eventIndex": 12,
          "sourceType": "user|ai|tool_output"
        }
      ]
    }
  ]
}`;

  const userParts: string[] = [
    `## Session Shape: ${sessionShape}`,
    `## Chunk ${chunk.chunkIndex} — Topic: ${chunk.topicHint}`,
    `## Files in scope: ${chunk.filesInScope.slice(0, 15).join(", ")}`,
  ];

  if (digestHeader) {
    userParts.push(digestHeader);
  }

  userParts.push(
    `## Events (${chunk.events.length} total):`,
    "",
    renderChunkEventsForPrompt(chunk.events),
    "",
    "Extract the meaningful moments from this chunk. Return JSON only.",
  );

  const user = userParts.join("\n");

  return { system, user };
}

/**
 * Render events for the prompt — same logic as renderChunkEvents but kept
 * local so the prompt builder is self-contained.
 */
function renderChunkEventsForPrompt(events: Array<{
  causalOrder: number;
  category: string;
  actor: string;
  content: { summary: string; detail: string; filesAffected?: string[] };
}>): string {
  return events
    .map((e) => {
      const co = e.causalOrder;
      const detail = e.content.detail;
      const summary = e.content.summary;
      const files = e.content.filesAffected ?? [];

      switch (e.category) {
        case "intent":
          return `[${co}] DEV: ${detail}`;

        case "proposal":
          return `[${co}] AI: ${detail}`;

        case "reflection":
          return `[${co}] AI: ${detail}`;

        case "action": {
          const fileStr = files.length > 0 ? files.join(", ") : summary;
          const detailSnippet = detail.slice(0, 200);
          return `[${co}] AI/ACTION(${fileStr}): ${detailSnippet}`;
        }

        case "result": {
          const lower = detail.toLowerCase();
          const isError =
            lower.includes("error") ||
            lower.includes("fail") ||
            lower.includes("err!");
          if (isError) {
            return `[${co}] RESULT(error): ${detail.slice(0, 300)}`;
          }
          return `[${co}] RESULT: ${summary.slice(0, 120)}`;
        }

        default:
          return `[${co}] ${e.actor.toUpperCase()}: ${detail}`;
      }
    })
    .join("\n");
}
