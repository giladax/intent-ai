import type {
  SessionMoment,
  IntentTransition,
  AcceptedOutcome,
  SessionShape,
  SessionNarrative,
  Sitting,
} from "../adapters/types.js";
import { callSonnet } from "../llm/client.js";
import {
  buildNarrativePrompt,
  SessionNarrativeSchema,
} from "../llm/prompts/narrative.js";
import type { Pass2Moment } from "../adapters/types.js";
import type { SessionShape as PromptSessionShape } from "../llm/prompts/classify.js";
import type {
  IntentTransition as PromptTransition,
  AcceptedOutcome as PromptOutcome,
} from "../llm/prompts/transitions.js";

/**
 * Generate a narrative summary of a session from its moments,
 * transitions, and outcomes. `sittings` defaults to [] so existing
 * callers compile without change; the orchestrator will pass real
 * sittings in a subsequent task.
 */
export async function generateNarrative(
  moments: SessionMoment[],
  transitions: IntentTransition[],
  outcomes: AcceptedOutcome[],
  sessionShape: SessionShape,
  sittings: Sitting[] = [],
): Promise<SessionNarrative> {
  const shapeObj: PromptSessionShape = { shape: sessionShape };

  // Convert domain types to prompt types
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
    verification: m.verification ?? undefined,
    occurredAt: m.occurredAt ?? undefined,
  }));

  const promptTransitions: PromptTransition[] = transitions.map((t) => ({
    fromStatement: t.fromStatement,
    toStatement: t.toStatement,
    reason: t.reason,
    triggeringMomentIndices: t.originMomentIds.map((id) => {
      const num = parseInt(id.replace("moment-", ""), 10);
      return isNaN(num) ? 0 : num;
    }),
    arcId: t.arcId ?? "",
    confidence: t.confidence,
  }));

  const promptOutcomes: PromptOutcome[] = outcomes.map((o) => ({
    statement: o.statement,
    supportingMomentIndices: o.supportingMomentIds.map((id) => {
      const num = parseInt(id.replace("moment-", ""), 10);
      return isNaN(num) ? 0 : num;
    }),
    filesAffected: o.supportingFiles,
    confidence: o.confidence,
  }));

  const { system, user } = buildNarrativePrompt({
    moments: pass2Moments,
    transitions: promptTransitions,
    outcomes: promptOutcomes,
    sessionShape: shapeObj,
    sittings,
  });

  const result = await callSonnet(system, user, SessionNarrativeSchema);

  return {
    sessionId: "", // Caller should set this
    sessionShape,
    summary: result.summary,
    progression: result.progression,
    discoveries: result.discoveries,
    stabilizedDirections: result.stabilizedDirections,
    abandonedDirections: result.abandonedDirections,
    arcs: result.arcs.map((arc) => ({
      arcId: arc.arcId,
      title: arc.title,
      summary: arc.summary,
      momentIds: arc.momentIds.map((idx) => `moment-${idx}`),
      resolution: mapResolution(arc.resolution),
    })),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

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

function mapResolution(
  res: string,
): "resolved" | "abandoned" | "open" {
  switch (res) {
    case "completed":
      return "resolved";
    case "abandoned":
      return "abandoned";
    case "ongoing":
      return "open";
    case "merged":
      return "resolved";
    default:
      return "open";
  }
}
