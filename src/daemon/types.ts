/**
 * Core types for the observe channel daemon.
 *
 * These types flow through the pipeline:
 *   hook/jsonl -> normalize -> correlate -> queue -> digest -> state -> suggest
 */

export interface ObservedEvent {
  source: 'hook' | 'jsonl';
  sessionId: string | null;
  kind: string; // user_prompt | tool_call | tool_result | tool_failure | assistant_text | assistant_stop | session_start | session_end | raw
  ts: number; // daemon receive time ms epoch
  transcriptPath?: string;
  raw: unknown;
  toolName?: string;
  toolInput?: unknown;
  toolResponse?: unknown;
  toolUseId?: string;
  prompt?: string;
}

export interface BatchDigest {
  summary: string;
  currentIntent: string;
  filesInFocus: string[];
  openQuestions: string[];
  significantEvent: boolean;
}

export interface SessionState {
  sessionId: string;
  startedAt: number;
  transcriptPath: string;
  turnCount: number;
  currentIntent: string;
  intentHistory: string[];
  filesInFocus: string[];
  toolsUsed: Record<string, number>;
  recentDigests: BatchDigest[];
  openQuestions: string[];
  significantEvents: string[];
  latestSuggestion: PromptSuggestion | null;
}

export interface PromptSuggestion {
  suggestions: Array<{
    prompt: string;
    reasoning: string;
    category: 'continue' | 'refine' | 'redirect' | 'verify' | 'explain';
  }>;
  sessionSummary: string;
  updatedAt: number;
}

export interface DigestionSink {
  ingest(evt: ObservedEvent): void | Promise<void>;
  flush?(): void | Promise<void>;
}
