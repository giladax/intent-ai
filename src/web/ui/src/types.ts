export interface Project {
  id: string;
  name: string;
  path: string;
  created_at: string;
}

export interface Feature {
  id: string;
  project_id: string;
  name: string;
  description: string;
  // WS-B / WS-A schema contract: understanding fields
  current_understanding?: string | null;
  constraints?: string[];
  known_unknowns?: string[];
  created_at: string;
  session_count: number;
}

// ── Feature↔File map (WS-B) ──────────────────────────────────────────
export interface FeatureFile {
  id: string;
  glob: string;
  file_path: string;
  created_at: string;
}

// ── Observation review queue (WS-B) ──────────────────────────────────
export interface PendingObservation {
  id: string;
  category: string; // observation:<kind>
  summary: string;
  feature_id: string | null;
  feature_name: string | null;
  review_status: string; // pending | approved | rejected (freeform)
  created_at: string;
  session_id?: string | null;
  tags?: string[] | null;
  actor?: string | null;
}

export interface FeatureObservation {
  id: string;
  category: string;
  summary: string;
  review_status: string;
  created_at: string;
}

export interface Session {
  id: string;
  source_type: string;
  source_path: string;
  session_shape: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  narrative_summary: string | null;
  moment_count: number;
}

export interface FeatureSession {
  id: string;
  sourceType: string;
  sourcePath: string;
  sessionShape: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  role: string;
  narrativeSummary: string | null;
  narrativeShape: string | null;
  momentCount: number;
}

export interface FeatureDetail {
  feature: Feature;
  sessions: FeatureSession[];
  story: string;
  files?: FeatureFile[];
  observations?: FeatureObservation[];
}

export interface SessionMoment {
  id: string;
  chunkId: string;
  type: string;
  statement: string;
  significance: string;
  agency: string;
  confidence: string;
  topicFingerprint: string;
  arcId?: string;
  arcRole?: string;
  evidence: Array<{
    quote: string;
    sourceType: string;
    quoteType: string;
  }>;
}

export interface SessionNarrative {
  sessionId: string;
  sessionShape: string;
  summary: string;
  progression: string[];
  discoveries: string[];
  stabilizedDirections: string[];
  abandonedDirections: string[];
  arcs: Array<{
    arcId: string;
    title: string;
    summary: string;
    resolution: string;
  }>;
}

export interface SessionDetail {
  session: {
    id: string;
    source_type: string;
    source_path: string;
    session_shape: string;
    started_at: string | null;
    ended_at: string | null;
  };
  narrative: SessionNarrative | null;
  moments: SessionMoment[];
  transitions: Array<{
    fromStatement: string;
    toStatement: string;
    reason: string;
    arcId?: string;
    confidence: string;
  }>;
  outcomes: Array<{
    statement: string;
    confidence: string;
  }>;
}

export interface EventWindow {
  chunkIndex: number;
  eventRangeStart: number;
  eventRangeEnd: number;
  topicHint: string | null;
}

export interface SessionSitting {
  sittingIndex: number;
  eventRangeStart: number;
  eventRangeEnd: number;
  startedAt: string;
  endedAt: string;
}

export interface EventWithWindows {
  id: string;
  causalOrder: number;
  category: string;
  actor: string;
  summary: string;
  windows: number[];
}

export interface SessionEventsWithWindows {
  events: EventWithWindows[];
  chunks: EventWindow[];
  sittings: SessionSitting[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// ── Journal (observability) ──────────────────────────────────────────
// Mirrors the pinned GET /api/journal contract exactly.
export interface JournalPulse {
  since: string | null;
  sessionsDigested: number;
  consults: number;
  consultMisses: number;
  observationsNoticed: number;
  pendingReview: number;
  reviewActions: number;
  learnings: number;
}

export type JournalEpisodeKind = "session" | "run" | "review-batch" | "observation" | "event";

export interface JournalBeat {
  id: string;
  timestamp: string;
  category: string;
  summary: string;
  actor: string;
  metadata: Record<string, unknown>;
}

export interface JournalPendingItem {
  id: string;
  summary: string;
  featureId: string | null;
  category: string;
}

export interface JournalEpisodeCounts {
  beats: number;
  consults: number;
  consultMisses: number;
  observations: number;
  moments: number;
}

export interface JournalEpisode {
  id: string;
  kind: JournalEpisodeKind;
  title: string;
  actor: string;
  startedAt: string;
  endedAt: string | null;
  featureIds: string[];
  counts: JournalEpisodeCounts;
  pending: JournalPendingItem[];
  beats: JournalBeat[];
}

export interface JournalResponse {
  pulse: JournalPulse;
  episodes: JournalEpisode[];
}

export interface JournalParams {
  since?: string;
  actor?: string;
  featureId?: string;
  limit?: number;
}
