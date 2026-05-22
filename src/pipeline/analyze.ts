import type {
  NormalizedDevEvent,
  TurnExchange,
  PipelineDirectives,
} from "../adapters/types.js";
import {
  classifyExchanges,
  type ExchangeClassification,
} from "./classify-exchanges.js";

/**
 * Analyze normalized events to produce pipeline directives.
 *
 * Groups events into turn exchanges (user message + following AI events),
 * classifies each exchange using Haiku structured output (NOT regex),
 * and derives aggregate directives.
 */
export async function analyzeInteractions(
  events: NormalizedDevEvent[],
): Promise<PipelineDirectives> {
  const exchanges = buildExchanges(events);

  if (exchanges.length === 0) {
    return emptyDirectives();
  }

  // Classify ALL exchanges in one Haiku batch call
  const classifications = await classifyExchanges(exchanges);

  return computeDirectives(exchanges, classifications);
}

// ── Exchange Building ─────────────────────────────────────────────────

/**
 * Build turn exchanges by pairing each intent (user conversation_turn)
 * with all following events until the next intent.
 * No semantic classification here — just structural pairing.
 */
function buildExchanges(events: NormalizedDevEvent[]): TurnExchange[] {
  const exchanges: TurnExchange[] = [];

  const intentIndices: number[] = [];
  for (let i = 0; i < events.length; i++) {
    if (events[i].category === "intent") {
      intentIndices.push(i);
    }
  }

  for (let k = 0; k < intentIndices.length; k++) {
    const devIdx = intentIndices[k];
    const devEvent = events[devIdx];
    const nextIntentIdx =
      k + 1 < intentIndices.length ? intentIndices[k + 1] : events.length;

    const aiTurnEvents = events.slice(devIdx + 1, nextIntentIdx);
    const devDetail = devEvent.content.detail;

    exchanges.push({
      devEvent,
      aiTurnEvents,
      devResponseChars: devDetail.length,
      // These are now populated from Haiku classification, not regex.
      // Set structural defaults here — classification overrides in computeDirectives.
      devAskedQuestion: devDetail.includes("?"),
      devUsedReasoning: false,  // Haiku determines this via engagement/intent
      devIntroducedNewTopic: false,  // Haiku determines via candidateType
      aiProposedMultipleOptions: false,  // Haiku determines via context
      devRespondedToAllOptions: false,
    });
  }

  return exchanges;
}

// ── Directive Computation ─────────────────────────────────────────────

function computeDirectives(
  exchanges: TurnExchange[],
  classifications: ExchangeClassification[],
): PipelineDirectives {
  const total = exchanges.length;

  let passiveCount = 0;
  let delegationCount = 0;
  let questionCount = 0;
  let challengeCount = 0;
  let reasoningCount = 0;
  let newTopicCount = 0;
  const ignoredProposals: string[] = [];

  for (let i = 0; i < total; i++) {
    const ex = exchanges[i];
    const cls = classifications[i];

    if (!cls) continue;

    // Use Haiku classification instead of regex
    if (cls.engagement === "passive") passiveCount++;
    if (cls.engagement === "challenging") challengeCount++;
    if (cls.intent === "question") questionCount++;
    if (cls.intent === "delegation") delegationCount++;
    if (cls.intent === "challenge" || cls.intent === "refinement") reasoningCount++;
    if (cls.candidateType === "pivot" || cls.candidateType === "proposal") newTopicCount++;

    // Detect ignored proposals: AI proposed with options, dev only addressed part
    if (cls.engagement === "passive" && cls.candidateType === null) {
      // Check if the AI turn had substantial proposals the dev didn't engage with
      const aiProposalCount = ex.aiTurnEvents.filter(
        e => e.category === "proposal" && e.content.detail.length > 200
      ).length;
      if (aiProposalCount > 1) {
        ignoredProposals.push(
          `Exchange at event ${ex.devEvent.causalOrder}: dev responded passively to multi-part AI proposal`,
        );
      }
    }
  }

  return {
    promptSections: {
      detectPassiveAcceptance: passiveCount / total >= 0.7,
      trackDelegation: delegationCount / total > 0.3 || (passiveCount - challengeCount) / total > 0.5,
      detectIgnoredProposals: ignoredProposals.length > 0,
      isLearningExchange: questionCount > 0,
    },
    exchangeSummary: {
      totalExchanges: total,
      shortResponseCount: passiveCount,
      questionCount,
      reasoningCount,
      newTopicCount,
      ignoredProposals,
    },
  };
}

function emptyDirectives(): PipelineDirectives {
  return {
    promptSections: {
      detectPassiveAcceptance: false,
      trackDelegation: false,
      detectIgnoredProposals: false,
      isLearningExchange: false,
    },
    exchangeSummary: {
      totalExchanges: 0,
      shortResponseCount: 0,
      questionCount: 0,
      reasoningCount: 0,
      newTopicCount: 0,
      ignoredProposals: [],
    },
  };
}
