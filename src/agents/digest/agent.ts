import { z } from "zod";
import type {
  NormalizedDevEvent,
  Sitting,
  SessionShape,
  SessionChunk,
  SessionMoment,
  IntentTransition,
  AcceptedOutcome,
  SessionNarrative,
  ActivityEvent,
  ExtractedMoment,
} from "../../adapters/types.js";
import type { AgentConfig, CustomNode } from "../core/types.js";
import { makeTranscriptTools } from "../tools/transcript.js";
import { makeGitTools } from "../tools/git.js";
import { MOMENT_TYPES_TAXONOMY, CONFIDENCE_RUBRIC, AGENCY_RUBRIC } from "../../llm/prompts/shared-rubrics.js";
import { DigestAgentOutputSchema, type DigestAgentOutput } from "./output-schema.js";
import { validateAnchors } from "../../pipeline/understand/extract.js";
import { ExtractOutputSchema } from "../../llm/prompts/understand/extract.js";

export { DigestAgentOutputSchema };

// ── buildDigestAgentConfig ────────────────────────────────────────────────────

export function buildDigestAgentConfig(session: {
  normalizedEvents: NormalizedDevEvent[];
  sittings: Sitting[];
  sessionShape: SessionShape;
}): AgentConfig & { outputSchema: typeof DigestAgentOutputSchema } {
  const tools = [
    ...makeTranscriptTools(session.normalizedEvents),
    ...makeGitTools(),
  ];

  const sittingsSummary = session.sittings
    .map((s) => `  Sitting ${s.sittingIndex}: events [${s.eventRange[0]}..${s.eventRange[1]}] (${s.startedAt} → ${s.endedAt})`)
    .join("\n");

  const systemPrompt = `You are an expert session analyst. Your task: read a developer coding session transcript and extract meaningful moments, transitions, outcomes, and a narrative summary.

Session shape: ${session.sessionShape}
Session has ${session.sittings.length} sitting(s):
${sittingsSummary}

${MOMENT_TYPES_TAXONOMY}

${CONFIDENCE_RUBRIC}

${AGENCY_RUBRIC}

## Rolling-Notes Instructions

Work sitting-by-sitting in causal order. For each sitting:
1. Use read_transcript_range or search_transcript to read the events.
2. Keep running working notes about open threads, candidate moments, and unresolved claims.
3. For every confirmation, breakthrough, or execution moment — check list_tool_events first before asserting. These types require tool-verified evidence.
4. The opening intent of the session (sitting 0) MUST yield at least one moment (the developer's first substantive message states what they came to do — usually a "commitment" or "proposal" with agency "developer").
5. Every evidence item MUST cite eventIndex — the [N] causal-order number from the event you are quoting.

## Rules

1. Every moment MUST have at least 1 evidence item with a real eventIndex.
2. Never fabricate quotes. Quotes must come from events you actually read via tools.
3. Confidence is nullable — omit or set to null if undecidable.
4. sittingIndex on each moment: which sitting the moment belongs to.
5. Fewer is better — 2-5 moments per sitting is normal. Only flag inflection points.
6. Use topicFingerprint in kebab-case to group related moments.`;

  // Custom node: validate anchors per sitting, repair if >30% unanchored
  const validateAnchorsNode: CustomNode = {
    name: "validate_anchors_and_repair",
    check: async (output: unknown, _state: unknown): Promise<string | null> => {
      const parsed = output as DigestAgentOutput;
      // M3: zero-moment output is never valid — every session has at least an
      // opening-intent moment from sitting 0.
      if (!parsed?.moments?.length) {
        return "Output contains zero moments. Every session has at least an opening-intent moment (see your instructions). Re-read sitting 0 and produce the digest.";
      }

      const sittingChunks = buildPseudoChunksPerSitting(
        session.sittings,
        session.normalizedEvents,
      );

      const failures: string[] = [];
      let totalEvidence = 0;
      let unanchoredCount = 0;

      for (let i = 0; i < parsed.moments.length; i++) {
        const m = parsed.moments[i];
        const chunk = sittingChunks.get(m.sittingIndex) ?? sittingChunks.get(0);
        if (!chunk) continue;

        const mockMoment: z.infer<typeof ExtractOutputSchema>["moments"][0] = {
          type: m.type,
          statement: m.statement,
          significance: m.significance ?? "",
          agency: m.agency,
          confidence: m.confidence ?? null,
          topicFingerprint: m.topicFingerprint ?? "general",
          evidence: m.evidence.map((e) => ({
            quote: e.quote,
            eventIndex: typeof e.eventIndex === "number" ? e.eventIndex : null,
            sourceType: (e.sourceType ?? "ai") as "user" | "ai" | "tool_output",
          })),
        };

        const anchored = validateAnchors([mockMoment], chunk);

        for (const anchoredMoment of anchored) {
          for (const ev of anchoredMoment.evidence) {
            totalEvidence++;
            if (!ev.anchored) {
              unanchoredCount++;
              failures.push(
                `moment[${i}] "${m.statement.slice(0, 40)}": evidence quote "${ev.quote.slice(0, 40)}" (cited eventIndex: ${ev.eventIndex}) is unanchored`,
              );
            }
          }
        }
      }

      if (totalEvidence === 0) return null;
      const rate = unanchoredCount / totalEvidence;
      if (rate > 0.3) {
        return `Anchor check failed: ${unanchoredCount}/${totalEvidence} evidence items (${Math.round(rate * 100)}%) are unanchored (>30% threshold). Fix these:\n${failures.join("\n")}\nUse read_transcript_range or search_transcript to find real event indices for each failing evidence item, then call final_output again with corrected data.`;
      }
      return null;
    },
  };

  return {
    name: "digest_agent",
    model: "claude-sonnet-4-6",
    systemPrompt,
    tools,
    maxTurns: 40,
    maxTokens: 400_000,
    outputSchema: DigestAgentOutputSchema,
    customNodes: [validateAnchorsNode],
  };
}

// ── buildPseudoChunksPerSitting ───────────────────────────────────────────────

export function buildPseudoChunksPerSitting(
  sittings: Sitting[],
  normalizedEvents: NormalizedDevEvent[],
): Map<number, SessionChunk> {
  const chunkMap = new Map<number, SessionChunk>();

  for (const sitting of sittings) {
    const [start, end] = sitting.eventRange;
    const events = normalizedEvents.filter(
      (e) => e.causalOrder >= start && e.causalOrder <= end,
    );
    const files = Array.from(
      new Set(events.flatMap((e) => e.content.filesAffected ?? [])),
    );

    const chunk: SessionChunk = {
      id: `pseudo-sitting-${sitting.sittingIndex}`,
      sessionId: events[0]?.sessionId ?? "unknown",
      chunkIndex: sitting.sittingIndex,
      events,
      topicHint: `sitting-${sitting.sittingIndex}`,
      filesInScope: files,
      eventRange: [start, end],
    };
    chunkMap.set(sitting.sittingIndex, chunk);
  }

  return chunkMap;
}

// ── mapAgentOutputToPipelineResult ────────────────────────────────────────────

export function mapAgentOutputToPipelineResult(
  agentOutput: DigestAgentOutput,
  sessionId: string,
  sittings: Sitting[],
  normalizedEvents: NormalizedDevEvent[],
  _sessionShape: SessionShape,
): {
  moments: SessionMoment[];
  chunks: SessionChunk[];
  transitions: IntentTransition[];
  outcomes: AcceptedOutcome[];
  narrative: SessionNarrative;
} {
  const pseudoChunks = buildPseudoChunksPerSitting(sittings, normalizedEvents);
  const chunks = Array.from(pseudoChunks.values());

  const moments: SessionMoment[] = agentOutput.moments.map((m, i) => {
    const chunk = pseudoChunks.get(m.sittingIndex) ?? chunks[0];
    const chunkId = chunk?.id ?? `pseudo-sitting-${m.sittingIndex}`;

    const mockMoment: z.infer<typeof ExtractOutputSchema>["moments"][0] = {
      type: m.type,
      statement: m.statement,
      significance: m.significance ?? "",
      agency: m.agency,
      confidence: m.confidence ?? null,
      topicFingerprint: m.topicFingerprint ?? "general",
      evidence: m.evidence.map((e) => ({
        quote: e.quote,
        eventIndex: typeof e.eventIndex === "number" ? e.eventIndex : null,
        sourceType: (e.sourceType ?? "ai") as "user" | "ai" | "tool_output",
      })),
    };

    let anchoredEvidence: ExtractedMoment["evidence"] = [];
    let occurredAt: string | null = null;

    if (chunk) {
      const [validated] = validateAnchors([mockMoment], chunk);
      if (validated) {
        anchoredEvidence = validated.evidence;
        occurredAt = validated.occurredAt;
      }
    }

    if (!occurredAt) {
      const sitting = sittings.find((s) => s.sittingIndex === m.sittingIndex);
      occurredAt = sitting?.startedAt ?? null;
    }

    return {
      id: `moment-${i}`,
      chunkId,
      type: m.type,
      statement: m.statement,
      significance: m.significance ?? "",
      agency: m.agency,
      confidence: (m.confidence ?? null) as SessionMoment["confidence"],
      topicFingerprint: m.topicFingerprint ?? "general",
      relatedMomentIds: [],
      // Cast: EvidenceAnchor[] satisfies the storage layer's duck-type check ("anchored" in e).
      // SessionMoment.evidence is typed as Evidence[] (legacy), but storage handles both shapes.
      evidence: anchoredEvidence as unknown as SessionMoment["evidence"],
      occurredAt,
      verification: null,
    };
  });

  const transitions: IntentTransition[] = (agentOutput.transitions ?? []).map((t, i) => ({
    id: `transition-${i}`,
    sessionId,
    fromStatement: t.fromStatement,
    toStatement: t.toStatement,
    reason: t.reason,
    originMomentIds: [],
    confidence: (t.confidence ?? null) as IntentTransition["confidence"],
  }));

  const outcomes: AcceptedOutcome[] = (agentOutput.outcomes ?? []).map((o, i) => ({
    id: `outcome-${i}`,
    sessionId,
    statement: o.statement,
    supportingMomentIds: [],
    supportingFiles: o.supportingFiles ?? [],
    confidence: (o.confidence ?? null) as AcceptedOutcome["confidence"],
  }));

  const narrative: SessionNarrative = {
    sessionId,
    sessionShape: agentOutput.narrative.sessionShape as SessionShape,
    summary: agentOutput.narrative.summary,
    progression: agentOutput.narrative.progression ?? [],
    discoveries: agentOutput.narrative.discoveries ?? [],
    stabilizedDirections: agentOutput.narrative.stabilizedDirections ?? [],
    abandonedDirections: agentOutput.narrative.abandonedDirections ?? [],
    arcs: [],
  };

  return { moments, chunks, transitions, outcomes, narrative };
}

// ── buildAgentTraceEvents ─────────────────────────────────────────────────────

export function buildAgentTraceEvents(
  sessionId: string,
  toolCalls: { name: string; ms: number; argsSummary: string }[],
  stats: { turns: number; tokensUsed: number; toolCalls: { name: string; ms: number; argsSummary: string }[]; repairs: number },
  gitCtx?: { repo?: string; branch?: string; worktree?: string },
): ActivityEvent[] {
  const events: ActivityEvent[] = [];

  for (const tc of toolCalls) {
    events.push({
      timestamp: new Date(),
      category: "agent:tool-call",
      tags: ["agent-trace", tc.name],
      actor: "agent",
      summary: `${tc.name}(${tc.argsSummary}) ${tc.ms}ms`,
      metadata: { toolName: tc.name, ms: tc.ms, argsSummary: tc.argsSummary },
      sourceType: "agent-trace",
      sessionId,
      repo: gitCtx?.repo,
      branch: gitCtx?.branch,
      worktree: gitCtx?.worktree,
    });
  }

  events.push({
    timestamp: new Date(),
    category: "agent:run",
    tags: ["agent-trace", "digest-agent"],
    actor: "agent",
    summary: `digest agent: ${stats.turns} turns, ${stats.tokensUsed} tokens, ${toolCalls.length} tool calls, ${stats.repairs} repairs`,
    metadata: {
      turns: stats.turns,
      tokensUsed: stats.tokensUsed,
      toolCallCount: toolCalls.length,
      repairs: stats.repairs,
    },
    sourceType: "agent-trace",
    sessionId,
    repo: gitCtx?.repo,
    branch: gitCtx?.branch,
    worktree: gitCtx?.worktree,
  });

  return events;
}
