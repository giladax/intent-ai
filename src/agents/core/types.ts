import type { z } from "zod";

// ── AgentToolDef ────────────────────────────────────────────────────────────
// Typed boundary every agent tool passes through.

export interface AgentToolDef<I = unknown, O = unknown> {
  /** Snake_case identifier, e.g. "read_transcript_range" */
  name: string;
  /** Written for the model — when to use it, what it returns */
  description: string;
  schema: z.ZodType<I>;
  execute: (input: I) => Promise<O>;
}

// ── CustomNode ──────────────────────────────────────────────────────────────
// Defined here so AgentConfig can reference it; full implementation in Task 3.

export interface CustomNode {
  name: string;
  /**
   * Runs after outputSchema validation passes.
   * Returns null to accept, or repair instructions (string) to bounce back to
   * the model. Implementation lives in graph.ts.
   */
  check: (output: unknown, state: unknown) => Promise<string | null>;
}

// ── AgentConfig ─────────────────────────────────────────────────────────────

export interface AgentConfig {
  name: string;
  /** Default: "claude-sonnet-4-6" */
  model?: string;
  systemPrompt: string;
  tools: AgentToolDef[];
  maxTurns: number;
  maxTokens: number;
  outputSchema: z.ZodType;
  customNodes?: CustomNode[];
}

// ── AgentResult ─────────────────────────────────────────────────────────────

export interface AgentResult<T = unknown> {
  output: T | null;
  /** Budget exhausted or output validation never passed */
  partial: boolean;
  stats: {
    turns: number;
    tokensUsed: number;
    toolCalls: { name: string; ms: number }[];
    repairs: number;
  };
  /** Present when partial — the raw last attempt */
  rawFinal?: string;
}
