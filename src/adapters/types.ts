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
