import type { FormatAllele } from "./types.js";
import type {
  NormalizedDevEvent,
  TurnExchange,
  PipelineDirectives,
} from "../../adapters/types.js";

// ── Helpers ─────────────────────────────────────────────────────────

function truncateDetail(text: string): string {
  return text.length > 400 ? text.slice(0, 400) + "..." : text;
}

function formatAiEvent(e: NormalizedDevEvent): string {
  const files = e.content.filesAffected ?? [];
  const detail = truncateDetail(e.content.detail);

  switch (e.category) {
    case "proposal":
    case "reflection":
      return `[${e.causalOrder}] "${detail}"`;
    case "action": {
      const toolMatch = e.content.summary.match(/^Tool:\s+(\S+)/);
      const toolName = toolMatch?.[1] ?? "Action";
      if (files.length > 0) {
        return `[${e.causalOrder}] ${toolName} ${files[0]}`;
      }
      return `[${e.causalOrder}] ${toolName}`;
    }
    case "result":
      return `[${e.causalOrder}] Result: ${truncateDetail(e.content.summary)}`;
    default:
      return `[${e.causalOrder}] ${detail}`;
  }
}

// ── 2b: Threaded Exchanges (current format) ─────────────────────────

export const threaded: FormatAllele = {
  name: "2b_threaded",
  render(
    exchanges: TurnExchange[],
    events: NormalizedDevEvent[],
    _directives?: PipelineDirectives,
  ): string {
    // Find all intent indices
    const intentIndices: number[] = [];
    for (let i = 0; i < events.length; i++) {
      if (events[i].category === "intent") {
        intentIndices.push(i);
      }
    }

    // If no intents, fall back to flat format
    if (intentIndices.length === 0) {
      return events
        .map((e) => {
          const actor = e.actor === "user" ? "DEV" : "AI";
          const category = e.category.toUpperCase();
          const files = e.content.filesAffected?.length
            ? ` [${e.content.filesAffected.join(", ")}]`
            : "";
          const detail = truncateDetail(e.content.detail);
          return `[${e.causalOrder}] ${actor}/${category}${files}: ${detail}`;
        })
        .join("\n\n");
    }

    const blocks: string[] = [];

    // Events before the first intent (standalone)
    if (intentIndices[0] > 0) {
      const standalone = events.slice(0, intentIndices[0]);
      blocks.push(
        standalone
          .map((e) => {
            const actor = e.actor === "user" ? "DEV" : "AI";
            const category = e.category.toUpperCase();
            return `[${e.causalOrder}] ${actor}/${category}: ${truncateDetail(e.content.detail)}`;
          })
          .join("\n\n"),
      );
    }

    // Each exchange: intent + following AI events until next intent
    for (let k = 0; k < intentIndices.length; k++) {
      const devIdx = intentIndices[k];
      const nextIntentIdx =
        k + 1 < intentIndices.length ? intentIndices[k + 1] : events.length;

      const devEvent = events[devIdx];
      const aiEvents = events.slice(devIdx + 1, nextIntentIdx);

      const devDetail = truncateDetail(devEvent.content.detail);

      let block = `── Exchange ──\n[${devEvent.causalOrder}] DEV: "${devDetail}"`;

      if (aiEvents.length > 0) {
        block += "\n  AI:";
        for (const ae of aiEvents) {
          block += `\n    - ${formatAiEvent(ae)}`;
        }
      }

      blocks.push(block);
    }

    return blocks.join("\n\n");
  },
};

// ── 2c: Behavioral Headers with Adaptive Content Density ────────────

export const behavioral: FormatAllele = {
  name: "2c_behavioral",
  render(
    exchanges: TurnExchange[],
    events: NormalizedDevEvent[],
    _directives?: PipelineDirectives,
  ): string {
    if (exchanges.length === 0) {
      return "(no exchanges)";
    }

    const blocks: string[] = [];

    for (const ex of exchanges) {
      const engagement = classifyEngagement(ex);
      const header = buildBehavioralHeader(ex, engagement);

      let content: string;
      if (engagement === "passive") {
        // Minimal: just the dev message and AI summary
        const aiSummary =
          ex.aiTurnEvents.length > 0
            ? ex.aiTurnEvents
                .filter(
                  (e) => e.category === "proposal" || e.category === "action",
                )
                .map((e) => truncateDetail(e.content.summary))
                .slice(0, 2)
                .join("; ")
            : "(no AI response)";
        content = `  DEV: "${truncateDetail(ex.devEvent.content.detail)}"\n  AI: ${aiSummary}`;
      } else {
        // Full: all events with details
        content = `  DEV: "${truncateDetail(ex.devEvent.content.detail)}"`;
        if (ex.aiTurnEvents.length > 0) {
          content += "\n  AI:";
          for (const ae of ex.aiTurnEvents) {
            content += `\n    - ${formatAiEvent(ae)}`;
          }
        }
      }

      blocks.push(`${header}\n${content}`);
    }

    return blocks.join("\n\n");
  },
};

// ── Behavioral helpers ──────────────────────────────────────────────

type Engagement = "passive" | "standard" | "challenge";

function classifyEngagement(ex: TurnExchange): Engagement {
  if (ex.devResponseChars < 15 && !ex.devAskedQuestion && !ex.devUsedReasoning) {
    return "passive";
  }
  if (ex.devUsedReasoning || ex.devIntroducedNewTopic || ex.devRespondedToAllOptions) {
    return "challenge";
  }
  return "standard";
}

function buildBehavioralHeader(ex: TurnExchange, engagement: Engagement): string {
  const flags: string[] = [];
  if (ex.devAskedQuestion) flags.push("Q");
  if (ex.devUsedReasoning) flags.push("R");
  if (ex.devIntroducedNewTopic) flags.push("NT");
  if (ex.aiProposedMultipleOptions) flags.push("MO");
  if (!ex.devRespondedToAllOptions && ex.aiProposedMultipleOptions) flags.push("IO");

  const flagStr = flags.length > 0 ? ` [${flags.join(",")}]` : "";
  return `── Exchange [${engagement.toUpperCase()}]${flagStr} ──`;
}
