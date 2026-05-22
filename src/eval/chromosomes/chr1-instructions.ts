import type { InstructionAllele, NodeContext } from "./types.js";

// ── 1a: Moment Hunter (current system prompt) ──────────────────────

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

export const hunter: InstructionAllele = {
  name: "1a_hunter",
  type: "llm",
  buildSystemPrompt(context: NodeContext): string {
    let directiveGuidance = "";
    if (context.directives?.promptSections) {
      const sections = context.directives.promptSections;
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
        directiveGuidance =
          "\n\n## Interaction Signals\n\n" + notes.join("\n\n");
      }
    }

    return `You are an expert at identifying meaningful moments in developer coding sessions. You read a sequence of events from one chunk of a session and extract the moments that matter.

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

${getShapeGuidance(context.sessionShape)}${directiveGuidance}

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
  },
};

// ── 1b: Exchange Scorer (simplified — 2 cognitive tasks) ────────────

export const scorer: InstructionAllele = {
  name: "1b_scorer",
  type: "llm",
  buildSystemPrompt(context: NodeContext): string {
    let directiveGuidance = "";
    if (context.directives?.promptSections) {
      const sections = context.directives.promptSections;
      const notes: string[] = [];
      if (sections.detectPassiveAcceptance) {
        notes.push("Watch for passive acceptance vs active agreement.");
      }
      if (sections.trackDelegation) {
        notes.push("Developer frequently delegates — note AI-driven moments.");
      }
      if (notes.length > 0) {
        directiveGuidance = "\n\n## Notes\n" + notes.join("\n");
      }
    }

    return `You receive pre-labeled exchanges from a developer coding session. Each exchange has a pre-computed candidate type, agency, and topic fingerprint.

Your job has exactly 2 tasks:
1. **Confirm or override** the candidate type. If the pre-computed label is wrong, fix it. If it's right, keep it.
2. **Write a one-sentence statement** capturing what happened in the developer's own language. Be specific — quote them.

## Valid moment types
proposal, discovery, pivot, confirmation, rejection, commitment, struggle, breakthrough, execution

## Rules
- If candidateType is "none" or null, you can still promote it to a moment if something significant happened.
- If candidateType looks right but the exchange is too trivial, set type to null to drop it.
- Statement MUST use the developer's actual words when possible.
- Keep agency as pre-computed unless clearly wrong.
- Fewer moments is better. Only flag inflection points.
${directiveGuidance}

## Output Format

Return ONLY a JSON object:
{
  "moments": [
    {
      "type": "proposal|discovery|pivot|confirmation|rejection|commitment|struggle|breakthrough|execution",
      "statement": "What happened, using developer's own language",
      "significance": "One line on why this matters",
      "agency": "developer|ai|collaborative",
      "confidence": "high|medium|low",
      "topicFingerprint": "kebab-case-topic-id",
      "evidence": [
        {
          "quote": "Key quote from the exchange",
          "sourceType": "user|ai|tool_output",
          "quoteType": "verbatim|paraphrase"
        }
      ]
    }
  ]
}`;
  },
};
