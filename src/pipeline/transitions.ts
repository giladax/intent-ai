import type {
  SessionMoment,
  IntentTransition,
  AcceptedOutcome,
} from "../adapters/types.js";
import { callSonnet } from "../llm/client.js";
import {
  buildTransitionsPrompt,
  TransitionsOutputSchema,
} from "../llm/prompts/transitions.js";
import type { Pass2Moment } from "../llm/prompts/moments.js";
import type { SessionShape as PromptSessionShape } from "../llm/prompts/classify.js";

/**
 * Detect intent transitions and accepted outcomes from session moments.
 */
export async function detectTransitionsAndOutcomes(
  moments: SessionMoment[],
  sessionId: string,
): Promise<{ transitions: IntentTransition[]; outcomes: AcceptedOutcome[] }> {
  // Convert SessionMoment[] to Pass2Moment[] for the prompt builder
  const pass2Moments: Pass2Moment[] = moments.map((m) => ({
    type: m.type,
    statement: m.statement,
    significance: m.significance as "high" | "medium" | "low",
    agency: mapAgency(m.agency),
    confidence: m.confidence,
    topicFingerprint: m.topicFingerprint,
    evidence: m.evidence.map((e) => ({
      quote: e.quote,
      sourceEventId: e.sourceEventId || undefined,
      sourceType: mapSourceTypeBack(e.sourceType),
      quoteType: e.quoteType === "verbatim" ? ("verbatim" as const) : ("paraphrase" as const),
    })),
    arcId: m.arcId ?? "",
    arcRole: mapArcRoleBack(m.arcRole),
    relatedMomentIds: m.relatedMomentIds.map((id) => {
      const num = parseInt(id.replace("moment-", ""), 10);
      return isNaN(num) ? 0 : num;
    }),
  }));

  // Collect all files from moments' evidence
  const filesInSession = collectFiles(moments);

  const shapeObj: PromptSessionShape = { shape: "narrative" }; // default; shape not needed for transitions
  const { system, user } = buildTransitionsPrompt({
    moments: pass2Moments,
    sessionShape: shapeObj,
    filesInSession,
  });

  const result = await callSonnet(system, user, TransitionsOutputSchema);

  // Map LLM output to our domain types
  const transitions: IntentTransition[] = result.transitions.map((t, i) => ({
    id: `transition-${i}`,
    sessionId,
    fromStatement: t.fromStatement,
    toStatement: t.toStatement,
    reason: t.reason,
    originMomentIds: t.triggeringMomentIndices.map((idx) => `moment-${idx}`),
    arcId: t.arcId,
    confidence: t.confidence,
  }));

  const outcomes: AcceptedOutcome[] = result.outcomes.map((o, i) => ({
    id: `outcome-${i}`,
    sessionId,
    statement: o.statement,
    supportingMomentIds: o.supportingMomentIndices.map(
      (idx) => `moment-${idx}`,
    ),
    supportingFiles: o.filesAffected,
    confidence: o.confidence,
  }));

  return { transitions, outcomes };
}

// ── Helpers ──────────────────────────────────────────────────────────

function collectFiles(moments: SessionMoment[]): string[] {
  const files = new Set<string>();
  for (const m of moments) {
    // topicFingerprint might hint at files, but we'll use evidence sourceEventIds
    // In practice, files come from the chunks — for now return empty
  }
  return Array.from(files);
}

function mapAgency(
  agency: string,
): "developer" | "ai" | "collaborative" {
  if (agency === "developer" || agency === "ai" || agency === "collaborative") {
    return agency;
  }
  return "collaborative";
}

function mapSourceTypeBack(
  st: string,
): "user" | "ai" | "tool_output" {
  switch (st) {
    case "human_message":
      return "user";
    case "ai_message":
      return "ai";
    case "tool_output":
      return "tool_output";
    default:
      return "user";
  }
}

function mapArcRoleBack(
  role?: string,
): "origin" | "development" | "turning_point" | "resolution" {
  switch (role) {
    case "origin":
      return "origin";
    case "turning_point":
      return "turning_point";
    case "resolution":
      return "resolution";
    default:
      return "development";
  }
}
