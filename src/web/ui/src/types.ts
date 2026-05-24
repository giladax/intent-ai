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
  created_at: string;
  session_count: number;
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

// ── Brain Types ──────────────────────────────────────────────────────

export interface TopicSummary {
  id: string;
  name: string;
  summary: string;
  parent_topic_id: string | null;
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
