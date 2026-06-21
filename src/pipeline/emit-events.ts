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
}

export function buildSessionEvents(input: SessionEventInput): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  const ctx = {
    sessionId: input.sessionId,
    repo: input.repo,
    branch: input.branch,
    worktree: input.worktree,
  };

  // Session summary event
  events.push({
    timestamp: new Date(),
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

  // Moment events
  for (const moment of input.moments) {
    events.push({
      timestamp: new Date(),
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

  // Transition events
  for (const transition of input.transitions) {
    events.push({
      timestamp: new Date(),
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

  // Outcome events
  for (const outcome of input.outcomes) {
    events.push({
      timestamp: new Date(),
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
