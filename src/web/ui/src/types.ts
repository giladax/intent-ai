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
  features: Array<{ featureId: string; role: string }>;
  topics: Array<{ topicId: string; topicName: string }>;
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

// ── Brain Types ──────────────────────────────────────────────────────

export interface TopicSummary {
  id: string;
  name: string;
  summary: string;
  parent_topic_id: string | null;
  updated_at: string;
  insight_count: number;
  session_count: number;
  update_count: number;
}

export interface TopicInsight {
  id: string;
  category: string;
  statement: string;
  confidence: number;
  reasoning?: string;
}

export interface TopicFile {
  file_path: string;
  role: string;
}

export interface TopicSession {
  session_id: string;
  session_shape: string | null;
  summary: string | null;
  started_at: string | null;
  moment_count: number;
}

export interface TopicRelated {
  id: string;
  name: string;
}

export interface TopicDetail {
  topic: { id: string; name: string; summary: string };
  insights: TopicInsight[];
  files: TopicFile[];
  sessions: TopicSession[];
  relatedTopics: TopicRelated[];
}

export interface BrainCard {
  node_name: string;
  level: string;
  summary: string;
  parent_node: string | null;
  children: string[] | null;
  insights: { category?: string; statement?: string }[] | null;
  files: string[] | null;
  related: string[] | null;
  sessions: string[] | null;
}

// ── Timeline Types ──────────────────────────────────────────────────
export interface TimelineCommit {
  sha: string;
  message: string;
  date: string;
}

export interface BrainVersion {
  id: string;
  commit_sha: string | null;
  created_at: string;
  topic_count: number;
  insight_count: number;
}

export interface TimelineData {
  commits: TimelineCommit[];
  brainVersions: BrainVersion[];
}

// ── Brain Sync Types ──────────────────────────────────────────────
export interface BrainSyncChange {
  type: "add" | "update" | "merge";
  spec?: string;
  from?: string[];
  into?: string;
  level?: string;
  parent?: string | null;
  fragmentCount?: number;
}

export interface BrainSyncSession {
  id: string;
  shape: string;
  summary: string;
  date: string;
  confidence: "high" | "medium" | "low";
  fileScore: number;
  timeScore: number;
  selected: boolean;
}

export interface BrainDiscoverResult {
  status: "up_to_date" | "sessions_found";
  digestedCount: number;
  undigestedCount?: number;
  sessions: BrainSyncSession[];
}

export interface BrainSyncProposal {
  status: "changes_proposed";
  changes: BrainSyncChange[];
  plan: any;
  specs: { name: string; summary: string; insightCount: number }[];
}

export interface SyncJobStatus {
  id: string;
  repoId: string;
  phase: "discovering" | "selecting" | "proposing" | "reviewing" | "applying" | "done" | "error";
  sessions?: BrainSyncSession[];
  proposal?: BrainSyncProposal;
  digestedCount?: number;
  error?: string;
  startedAt: number;
}
