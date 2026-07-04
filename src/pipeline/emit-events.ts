import type {
  SessionMoment,
  IntentTransition,
  AcceptedOutcome,
  SessionNarrative,
  ActivityEvent,
} from "../adapters/types.js";

export interface SessionEventInput {
  sessionId: string;
  repo?: string;
  branch?: string;
  worktree?: string;
  moments: SessionMoment[];
  transitions: IntentTransition[];
  outcomes: AcceptedOutcome[];
  narrative: SessionNarrative;
  /** Timestamp to use for narrative/transition/outcome events. Falls back to new Date(). */
  sessionEndedAt?: Date | null;
}

export function buildSessionEvents(input: SessionEventInput): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  const ctx = {
    sessionId: input.sessionId,
    repo: input.repo,
    branch: input.branch,
    worktree: input.worktree,
  };

  // Fallback timestamp for session-level events (narrative, transitions, outcomes)
  const sessionTs = input.sessionEndedAt ?? new Date();

  // Session summary event
  events.push({
    timestamp: sessionTs,
    category: input.narrative.sessionShape,
    tags: [],
    actor: "system",
    summary: input.narrative.summary,
    metadata: {
      progression: input.narrative.progression,
      discoveries: input.narrative.discoveries,
      stabilizedDirections: input.narrative.stabilizedDirections,
      abandonedDirections: input.narrative.abandonedDirections,
      arcCount: input.narrative.arcs.length,
    },
    sourceType: "narrative",
    sourceId: input.sessionId,
    ...ctx,
  });

  // Moment events — stamp with occurredAt when available, else new Date().
  // Guard against malformed strings: new Date("garbage") yields Invalid Date
  // whose .toISOString() throws — fall back to new Date() in that case.
  for (const moment of input.moments) {
    const parsed = moment.occurredAt != null ? new Date(moment.occurredAt) : null;
    const momentTs = parsed != null && !Number.isNaN(parsed.getTime()) ? parsed : new Date();
    events.push({
      timestamp: momentTs,
      category: moment.type,
      tags: [moment.topicFingerprint, moment.significance, moment.confidence].filter(Boolean) as string[],
      actor: moment.agency,
      summary: moment.statement,
      metadata: {
        significance: moment.significance,
        confidence: moment.confidence,
        arcId: moment.arcId,
        arcRole: moment.arcRole,
        chunkId: moment.chunkId,
      },
      sourceType: "moment",
      sourceId: moment.id,
      ...ctx,
    });
  }

  // Transition events — stamp with sessionEndedAt
  for (const transition of input.transitions) {
    events.push({
      timestamp: sessionTs,
      category: "transition",
      tags: [],
      actor: "collaborative",
      summary: `${transition.fromStatement} → ${transition.toStatement}: ${transition.reason}`,
      metadata: {
        from: transition.fromStatement,
        to: transition.toStatement,
        reason: transition.reason,
        confidence: transition.confidence,
        originMomentIds: transition.originMomentIds,
      },
      sourceType: "transition",
      sourceId: transition.id,
      ...ctx,
    });
  }

  // Outcome events — stamp with sessionEndedAt
  for (const outcome of input.outcomes) {
    events.push({
      timestamp: sessionTs,
      category: "outcome",
      tags: [],
      actor: "collaborative",
      summary: outcome.statement,
      metadata: {
        confidence: outcome.confidence,
        supportingMomentIds: outcome.supportingMomentIds,
      },
      sourceType: "outcome",
      sourceId: outcome.id,
      files: outcome.supportingFiles,
      ...ctx,
    });
  }

  return events;
}
