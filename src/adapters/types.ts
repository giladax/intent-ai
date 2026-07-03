// ── Raw Dev Event ─────────────────────────────────────────────────────
// Unified event format respondingTorespondingTo
// produced by source adapters (Claude Code, etc.)

export interface RawDevEvent {
  /** Unique ID — the uuid from the original log entry */
  id: string;

  /** Which tool/system produced this event */
  source: "claude-code";

  /** ISO 8601 timestamp */
  timestamp: string;

  /** Semantic event type */
  type:
    | "conversation_turn" // user message
    | "tool_call"         // AI tool use (Edit, Write, Bash, etc.)
    | "tool_result"       // tool results from user messages containing tool_result content
    | "ai_response";      // AI text response

  /** Original log entry, preserved verbatim */
  raw: Record<string, unknown>;
}

// ── Normalized Dev Event ─────────────────────────────────────────────
// Unified format consumed by the rest of the pipeline after normalization.

export interface NormalizedDevEvent {
  id: string;
  sessionId: string;
  timestamp: string;
  causalOrder: number;
  category: "intent" | "proposal" | "action" | "result" | "reflection";
  actor: "user" | "ai";
  content: {
    summary: string;
    detail: string;
    filesAffected?: string[];
  };
  rawEventId: string;
  respondingTo?: string;
  turnId: string;
}

// ── Turn Exchange ───────────────────────────────────────────────────
// Groups a developer event with the AI events that follow it,
// capturing interaction patterns for the causal threading pipeline.

export interface TurnExchange {
  devEvent: NormalizedDevEvent;
  aiTurnEvents: NormalizedDevEvent[];
  devResponseChars: number;
  devAskedQuestion: boolean;
  devUsedReasoning: boolean;
  devIntroducedNewTopic: boolean;
  aiProposedMultipleOptions: boolean;
  devRespondedToAllOptions: boolean;
}

// ── Pipeline Directives ─────────────────────────────────────────────
// Aggregated signals derived from turn exchanges,
// used to steer downstream prompt assembly and analysis.

export interface PipelineDirectives {
  promptSections: {
    detectPassiveAcceptance: boolean;
    trackDelegation: boolean;
    detectIgnoredProposals: boolean;
    isLearningExchange: boolean;
  };
  exchangeSummary: {
    totalExchanges: number;
    shortResponseCount: number;
    questionCount: number;
    reasoningCount: number;
    newTopicCount: number;
    ignoredProposals: string[];
  };
}

// ── Session Chunk ────────────────────────────────────────────────────
// Bounded reasoning window produced by the chunking step of the pipeline.

export interface SessionChunk {
  id: string;
  sessionId: string;
  chunkIndex: number;
  events: NormalizedDevEvent[];
  topicHint: string;
  filesInScope: string[];
  eventRange: [number, number]; // [startCausalOrder, endCausalOrder]
}

// ── Session Shape ────────────────────────────────────────────────────

export type SessionShape =
  | "narrative"
  | "exploratory"
  | "janitorial"
  | "debugging"
  | "review";

// ── Moments ─────────────────────────────────────────────────────────

export type MomentType =
  | "proposal"
  | "discovery"
  | "pivot"
  | "confirmation"
  | "rejection"
  | "commitment"
  | "struggle"
  | "breakthrough"
  | "execution";

export interface Evidence {
  quote: string;
  sourceEventId: string;
  sourceType: "human_message" | "ai_message" | "tool_output" | "tool_input";
  quoteType: "verbatim" | "summarized";
}

export interface SessionMoment {
  id: string;
  chunkId: string;
  type: MomentType;
  statement: string;
  significance: string;
  agency: "developer" | "ai" | "collaborative" | "ambiguous";
  confidence: "high" | "medium" | "low";
  topicFingerprint: string;
  relatedMomentIds: string[];
  arcId?: string;
  arcRole?: "origin" | "escalation" | "turning_point" | "resolution";
  evidence: Evidence[];
  occurredAt?: string | null;
  verification?: "supported" | "contradicted" | "unverified" | null;
}

// ── Transitions & Outcomes ──────────────────────────────────────────

export interface IntentTransition {
  id: string;
  sessionId: string;
  fromStatement: string;
  toStatement: string;
  reason: string;
  originMomentIds: string[];
  arcId?: string;
  confidence: "high" | "medium" | "low";
}

export interface AcceptedOutcome {
  id: string;
  sessionId: string;
  statement: string;
  supportingMomentIds: string[];
  supportingFiles: string[];
  confidence: "high" | "medium" | "low";
}

// ── Narrative ───────────────────────────────────────────────────────

export interface NarrativeArc {
  arcId: string;
  title: string;
  summary: string;
  momentIds: string[];
  resolution: "resolved" | "abandoned" | "open";
}

export interface SessionNarrative {
  sessionId: string;
  sessionShape: SessionShape;
  summary: string;
  progression: string[];
  discoveries: string[];
  stabilizedDirections: string[];
  abandonedDirections: string[];
  arcs: NarrativeArc[];
}

// ── Source Adapter Interface ──────────────────────────────────────────

export interface SourceAdapter {
  /** Parse a log file and return raw events */
  parse(filePath: string): Promise<RawDevEvent[]>;
}

// ── Repo Brain ──────────────────────────────────────────────────────

export type InsightCategory =
  | "structure"
  | "decision"
  | "constraint"
  | "behavior"
  | "risk"
  | "interface"
  | "navigation"
  | "pitfall";

export interface FileRef {
  path: string;
  role: string;
}

export interface EvidenceRef {
  sessionId: string;
  momentId?: string;
}

export interface Insight {
  id: string;
  topicId: string;
  category: InsightCategory;
  statement: string;
  evidence: EvidenceRef[];
  confidence: number;
  status: "active" | "stale" | "deprecated";
}

export interface TopicRelation {
  topicId: string;
  relationship: string;
}

export interface Topic {
  id: string;
  repoId: string;
  name: string;
  summary: string;
  insights: Insight[];
  fileRefs: FileRef[];
  sessionRefs: string[];
  relatedTopics: TopicRelation[];
}

export interface BrainVersion {
  id: string;
  repoId: string;
  commitSha: string;
  parentVersionId?: string;
  createdAt: string;
}

/** Evidence source for brain synthesis — sessions or PR analysis */
export interface BrainEvidence {
  sessions: string[];
  commits: string[];
  filesChanged: string[];
}

export interface BrainMutation {
  id: string;
  baseVersionId: string;
  targetCommitSha: string;
  evidence: BrainEvidence;
  createdInsights: Insight[];
  updatedInsights: { insightId: string; before: string; after: string }[];
  deprecatedInsightIds: string[];
  newTopics: Topic[];
  report: string;
}

// ── Brain Card ──────────────────────────────────────────────────────
// Deterministic compression of a full spec — used for dashboard display.

export interface BrainCard {
  name: string;
  level: "area" | "spec" | "file";
  path?: string | null;              // file level only
  parent?: string | null;
  children?: string[];
  summary: string;                   // ~100-150 words, the arc
  insights: {
    category: string;
    statement: string;
  }[];
  files?: string[];                  // key files (spec/area level)
  exports?: string[];                // file level
  related?: string[];
  sessions: string[];
  versionId?: string;
}

export interface TopicPattern {
  id?: string;
  topicId: string;
  type: "request" | "struggle" | "file_access";
  statement: string;
  frequency: number;
  confidence: "high" | "medium" | "low";
  fileAssociations: string[];
  evidence: { sessionId: string; momentId?: string }[];
}

export interface TopicSkill {
  id?: string;
  topicId: string;
  name: string;
  description: string;
  steps: SkillStep[];
  pitfalls: string[];
  files: string[];
  status: "draft" | "approved" | "validated";
  evidence: { sessionId: string; momentId?: string }[];
}

export interface SkillStep {
  order: number;
  instruction: string;
  files: string[];
  notes?: string;
}

// ── Understanding Stage Types ────────────────────────────────────────

export interface Sitting {
  sittingIndex: number;          // 0-based
  startedAt: string;             // ISO, first event's timestamp
  endedAt: string;               // ISO, last event's timestamp
  eventRange: [number, number];  // causalOrder span, inclusive
}

export interface EvidenceAnchor {
  quote: string;
  eventIndex: number | null;     // causalOrder cited by the LLM (null if unparseable)
  anchored: boolean;             // code-verified: index in chunk range AND quote found in that event
  sourceType: "user" | "ai" | "tool_output";
}

export interface ExtractedMoment {
  id: string;                    // deterministic: `c${chunkIndex}-m${i}`, assigned in code
  chunkIndex: number;
  type: SessionMoment["type"];
  statement: string;
  significance: string;
  agency: "developer" | "ai" | "collaborative";
  confidence: "high" | "medium" | "low" | null;
  topicFingerprint: string;
  evidence: EvidenceAnchor[];    // ≥1, schema-enforced at the LLM boundary
  occurredAt: string | null;     // ISO; first anchored evidence's event timestamp, else chunk start
}

// ── Activity Events ─────────────────────────────────────────────────

export interface ActivityEvent {
  id?: string;
  timestamp: Date;
  category: string;
  tags: string[];
  actor: string;
  summary: string;
  metadata: Record<string, unknown>;
  sourceType?: string;
  sourceId?: string;
  sessionId?: string;
  repo?: string;
  branch?: string;
  worktree?: string;
  topicIds?: string[];
  files?: string[];
  embedding?: number[];
}
