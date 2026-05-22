import type {
  RawDevEvent,
  NormalizedDevEvent,
  TurnExchange,
  PipelineDirectives,
} from "../../adapters/types.js";

// ── Chr 1: Instructions — what the node does ────────────────────────

export interface InstructionAllele {
  name: string;
  type: "llm" | "deterministic";
  buildSystemPrompt(context: NodeContext): string;
}

// ── Chr 2: Format — how input is rendered for the LLM ───────────────

export interface FormatAllele {
  name: string;
  render(
    exchanges: TurnExchange[],
    events: NormalizedDevEvent[],
    directives?: PipelineDirectives,
  ): string;
}

// ── Chr 3: Synthesis — what's pre-computed before the node runs ─────

export interface SynthesisAllele {
  name: string;
  process(events: NormalizedDevEvent[]): SynthesizedData | Promise<SynthesizedData>;
}

// ── Chr 4: Data Selection — what raw data enters ────────────────────

export interface DataAllele {
  name: string;
  select(events: RawDevEvent[]): RawDevEvent[];
}

// ── Supporting types ────────────────────────────────────────────────

export interface NodeContext {
  sessionShape: string;
  chunkIndex: number;
  totalChunks: number;
  directives?: PipelineDirectives;
}

export interface SynthesizedData {
  exchanges: TurnExchange[];
  directives: PipelineDirectives;
  /** Additional pre-computed fields for Chr 3c+ */
  enrichedExchanges?: EnrichedExchange[];
}

export interface EnrichedExchange {
  devEvent: NormalizedDevEvent;
  aiTurnEvents: NormalizedDevEvent[];
  agency: "developer" | "ai" | "collaborative" | "ambiguous";
  candidateType: string | null;
  topicFingerprint: string;
  notableQuotes: { speaker: "dev" | "ai"; text: string }[];
}

// ── Organism — 4 chromosomes assembled into a node ──────────────────

export interface Organism {
  name: string;
  instructions: InstructionAllele;
  format: FormatAllele;
  synthesis: SynthesisAllele;
  dataSelection: DataAllele;
}
