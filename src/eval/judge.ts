import { z } from "zod";
import { callHaiku } from "../llm/client.js";
import type { ScopeCriteria } from "../../tests/eval/session-criteria.js";
import type { SessionMoment, SessionNarrative } from "../adapters/types.js";

// ── Judge Score Interface ─────────────────────────────────────────────

export interface JudgeScore {
  momentCoverage: { score: number; reasoning: string; found: string[]; missed: string[] };
  momentQuality: { score: number; reasoning: string };
  narrativeAccuracy: { score: number; reasoning: string };
  narrativeInsight: { score: number; reasoning: string };
  antiPatterns: { score: number; reasoning: string };
  overall: number;
}

// ── Zod Schema for Judge Response ─────────────────────────────────────

const JudgeResponseSchema = z.object({
  momentCoverage: z.object({
    score: z.number().min(1).max(5),
    reasoning: z.string(),
    found: z.array(z.string()).optional().default([]),
    missed: z.array(z.string()).optional().default([]),
  }),
  momentQuality: z.object({
    score: z.number().min(1).max(5),
    reasoning: z.string(),
  }),
  narrativeAccuracy: z.object({
    score: z.number().min(1).max(5),
    reasoning: z.string(),
  }),
  narrativeInsight: z.object({
    score: z.number().min(1).max(5),
    reasoning: z.string(),
  }),
  antiPatterns: z.object({
    score: z.number().min(1).max(5),
    reasoning: z.string(),
  }),
});

// ── Weights ───────────────────────────────────────────────────────────

const WEIGHTS = {
  momentCoverage: 0.25,
  momentQuality: 0.25,
  narrativeAccuracy: 0.20,
  narrativeInsight: 0.20,
  antiPatterns: 0.10,
} as const;

// ── Judge Function ────────────────────────────────────────────────────

export async function judgeOutput(
  criteria: ScopeCriteria,
  moments: SessionMoment[],
  narrative: SessionNarrative,
): Promise<JudgeScore> {
  const systemPrompt = buildJudgeSystemPrompt();
  const userPrompt = buildJudgeUserPrompt(criteria, moments, narrative);

  const response = await callHaiku(systemPrompt, userPrompt, JudgeResponseSchema, {
    maxTokens: 4096,
  });

  const overall =
    response.momentCoverage.score * WEIGHTS.momentCoverage +
    response.momentQuality.score * WEIGHTS.momentQuality +
    response.narrativeAccuracy.score * WEIGHTS.narrativeAccuracy +
    response.narrativeInsight.score * WEIGHTS.narrativeInsight +
    response.antiPatterns.score * WEIGHTS.antiPatterns;

  return {
    momentCoverage: {
      score: response.momentCoverage.score,
      reasoning: response.momentCoverage.reasoning,
      found: response.momentCoverage.found,
      missed: response.momentCoverage.missed,
    },
    momentQuality: response.momentQuality,
    narrativeAccuracy: response.narrativeAccuracy,
    narrativeInsight: response.narrativeInsight,
    antiPatterns: response.antiPatterns,
    overall,
  };
}

// ── Prompt Builders ───────────────────────────────────────────────────

function buildJudgeSystemPrompt(): string {
  return `You are evaluating the quality of an execution memory digest — a structured reconstruction of how understanding evolved during an AI-assisted development session.

You will receive:
1. Ground truth: a human-written description of what actually happened
2. Expected moments: key moments that should have been detected
3. The pipeline's actual output: detected moments and generated narrative

Score on 5 dimensions (1-5 each). Be rigorous but fair. A score of 3 means "acceptable but with notable gaps." A 5 means "excellent, hard to improve."

Respond with ONLY a JSON object matching this structure:
{
  "momentCoverage": { "score": <1-5>, "reasoning": "<why>", "found": ["<moment topics found>"], "missed": ["<moment topics missed>"] },
  "momentQuality": { "score": <1-5>, "reasoning": "<why>" },
  "narrativeAccuracy": { "score": <1-5>, "reasoning": "<why>" },
  "narrativeInsight": { "score": <1-5>, "reasoning": "<why>" },
  "antiPatterns": { "score": <1-5>, "reasoning": "<why>" }
}`;
}

function buildJudgeUserPrompt(
  criteria: ScopeCriteria,
  moments: SessionMoment[],
  narrative: SessionNarrative,
): string {
  // Ground truth
  const groundTruth = criteria.groundTruth ?? "(No ground truth provided)";

  // Expected moments
  const expectedMoments = criteria.mustDetectMoments
    .map((m, i) => {
      const phrase = m.containsPhrase ? ` (should mention: "${m.containsPhrase}")` : "";
      return `  ${i + 1}. [${m.type}] ${m.topic} — agency: ${m.agency}${phrase}`;
    })
    .join("\n");

  // Anti-patterns to avoid
  const antiPatterns = criteria.mustNotDetect.length > 0
    ? `\n## Things That Should NOT Appear\n${criteria.mustNotDetect.map((a) => `  - "${a}"`).join("\n")}`
    : "";

  // Pipeline's moments output
  const momentsOutput = moments.length > 0
    ? moments
        .map((m, i) => {
          const evidenceQuotes = m.evidence.map((e) => `"${e.quote}"`).join("; ");
          return `  ${i + 1}. [${m.type}] "${m.statement}" — agency: ${m.agency}, topic: ${m.topicFingerprint}\n     Evidence: ${evidenceQuotes || "(none)"}`;
        })
        .join("\n")
    : "  (no moments detected)";

  // Pipeline's narrative output
  const narrativeOutput = [
    `Summary: ${narrative.summary}`,
    `Progression:\n${narrative.progression.map((p) => `  - ${p}`).join("\n")}`,
    `Discoveries:\n${narrative.discoveries.map((d) => `  - ${d}`).join("\n")}`,
    narrative.abandonedDirections.length > 0
      ? `Abandoned:\n${narrative.abandonedDirections.map((a) => `  - ${a}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return `## What Actually Happened (ground truth)

${groundTruth}

## Key Moments That Should Be Detected

${expectedMoments}
${antiPatterns}

## The Pipeline's Output

### Moments Detected:
${momentsOutput}

### Narrative:
${narrativeOutput}

## Score on 5 Dimensions (1-5 each)

1. **Moment Coverage**: Were the key moments detected? Check each expected moment against what was found.
2. **Moment Quality**: Are statements specific and evidence-backed? Do they use the developer's own language? Is agency attribution correct?
3. **Narrative Accuracy**: Does the narrative capture what actually happened? Does it use the developer's own words?
4. **Narrative Insight**: Does it reveal HOW the developer worked (behavioral patterns, delegation, engagement), not just WHAT happened?
5. **Anti-Patterns** (5 = no anti-patterns): Any generic statements ("the developer decided")? Wrong agency? Hallucinated claims? Vague language ("various changes")?

For each, give a score and reasoning. Return JSON only.`;
}
