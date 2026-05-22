import type {
  NormalizedDevEvent,
  TurnExchange,
  PipelineDirectives,
} from "../adapters/types.js";

const REASONING_PATTERN =
  /\b(because|actually|instead|but|however|rather)\b/i;

const MULTIPLE_OPTIONS_PATTERN =
  /[A-D]\)|option [A-D]|approach [A-D]/i;

/**
 * Analyze normalized events to produce pipeline directives.
 *
 * Groups events into turn exchanges (user message + following AI events),
 * computes per-exchange interaction flags, and derives aggregate directives.
 */
export function analyzeInteractions(
  events: NormalizedDevEvent[],
): PipelineDirectives {
  const exchanges = buildExchanges(events);
  return computeDirectives(exchanges);
}

// ── Exchange Building ─────────────────────────────────────────────────

/**
 * Build turn exchanges by pairing each intent (user conversation_turn)
 * with all following events until the next intent.
 */
function buildExchanges(events: NormalizedDevEvent[]): TurnExchange[] {
  const exchanges: TurnExchange[] = [];

  // Find all intent events (user messages)
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

    // AI turn events: everything between this intent and the next
    const aiTurnEvents = events.slice(devIdx + 1, nextIntentIdx);

    // Collect all AI text from the PREVIOUS AI turn (the one this dev event responds to)
    // to check if it proposed multiple options
    const previousAiText = getPreviousAiTurnText(events, devIdx);

    const devDetail = devEvent.content.detail;
    const devResponseChars = devDetail.length;
    const devAskedQuestion = devDetail.includes("?");
    const devUsedReasoning = REASONING_PATTERN.test(devDetail);

    // Check if dev introduced a new topic by mentioning files not in prior AI turn
    const devIntroducedNewTopic = checkNewTopic(devEvent, events, devIdx);

    // Check if the prior AI proposed multiple options
    const aiProposedMultipleOptions = MULTIPLE_OPTIONS_PATTERN.test(previousAiText);

    // Check if dev responded to all proposed options
    const devRespondedToAllOptions = aiProposedMultipleOptions
      ? checkRespondedToAllOptions(devDetail, previousAiText)
      : false;

    exchanges.push({
      devEvent,
      aiTurnEvents,
      devResponseChars,
      devAskedQuestion,
      devUsedReasoning,
      devIntroducedNewTopic,
      aiProposedMultipleOptions,
      devRespondedToAllOptions,
    });
  }

  return exchanges;
}

/**
 * Get the combined text from the AI turn that precedes the given event index.
 * This is the AI turn that the dev event is responding to.
 */
function getPreviousAiTurnText(
  events: NormalizedDevEvent[],
  devIdx: number,
): string {
  const devEvent = events[devIdx];

  // Find the event this dev event is responding to
  if (!devEvent.respondingTo) return "";

  const respondedEvent = events.find((e) => e.id === devEvent.respondingTo);
  if (!respondedEvent) return "";

  // Get all events with the same turnId as the responded event
  const turnId = respondedEvent.turnId;
  const turnTexts: string[] = [];
  for (const e of events) {
    if (e.turnId === turnId && e.actor === "ai") {
      turnTexts.push(e.content.detail);
    }
  }
  return turnTexts.join("\n");
}

/**
 * Check if the dev introduced a new topic not present in the prior AI context.
 * A new topic is detected when the dev mentions file paths or concepts
 * not in the AI turn's filesAffected.
 */
function checkNewTopic(
  devEvent: NormalizedDevEvent,
  events: NormalizedDevEvent[],
  devIdx: number,
): boolean {
  // First intent has no prior context — it establishes the topic
  if (devIdx === 0) return false;
  if (!devEvent.respondingTo) return false;

  const respondedEvent = events.find((e) => e.id === devEvent.respondingTo);
  if (!respondedEvent) return false;

  // Get all files from the prior AI turn
  const priorTurnId = respondedEvent.turnId;
  const priorFiles = new Set<string>();
  for (const e of events) {
    if (e.turnId === priorTurnId && e.content.filesAffected) {
      for (const f of e.content.filesAffected) {
        priorFiles.add(f);
      }
    }
  }

  // Also collect files from the broader conversation up to this point
  const allPriorFiles = new Set<string>();
  for (let i = 0; i < devIdx; i++) {
    if (events[i].content.filesAffected) {
      for (const f of events[i].content.filesAffected) {
        allPriorFiles.add(f);
      }
    }
  }

  // Check if dev message references concepts not in prior conversation
  // Heuristic: look for mentions of new technical concepts
  const devText = devEvent.content.detail.toLowerCase();

  // Check for topic shift keywords (testing, deployment, etc.)
  // when the prior conversation was about something else
  const topicKeywords = ["test", "deploy", "migrate", "refactor", "debug", "performance", "security"];
  const priorTexts: string[] = [];
  for (let i = 0; i < devIdx; i++) {
    priorTexts.push(events[i].content.detail.toLowerCase());
  }
  const priorContext = priorTexts.join(" ");

  for (const keyword of topicKeywords) {
    if (devText.includes(keyword) && !priorContext.includes(keyword)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if the dev response addresses all proposed options.
 */
function checkRespondedToAllOptions(
  devText: string,
  aiText: string,
): boolean {
  // Find which options were proposed (A, B, C, D)
  const proposedOptions = new Set<string>();
  const optionPattern = /([A-D])\)|option ([A-D])|approach ([A-D])/gi;
  let match: RegExpExecArray | null;
  while ((match = optionPattern.exec(aiText)) !== null) {
    const letter = (match[1] || match[2] || match[3]).toUpperCase();
    proposedOptions.add(letter);
  }

  if (proposedOptions.size <= 1) return true; // Only one option, trivially responded

  // Check if dev response references multiple options
  const devUpper = devText.toUpperCase();
  let mentionedCount = 0;
  for (const option of proposedOptions) {
    if (devUpper.includes(option)) mentionedCount++;
  }

  return mentionedCount >= proposedOptions.size;
}

// ── Directive Computation ─────────────────────────────────────────────

function computeDirectives(exchanges: TurnExchange[]): PipelineDirectives {
  const total = exchanges.length;
  if (total === 0) {
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

  let shortResponseCount = 0;
  let questionCount = 0;
  let reasoningCount = 0;
  let newTopicCount = 0;
  const ignoredProposals: string[] = [];

  let noDelegationCount = 0; // exchanges where dev didn't reason AND didn't introduce new topic

  for (const ex of exchanges) {
    if (ex.devResponseChars < 15) shortResponseCount++;
    if (ex.devAskedQuestion) questionCount++;
    if (ex.devUsedReasoning) reasoningCount++;
    if (ex.devIntroducedNewTopic) newTopicCount++;

    if (!ex.devUsedReasoning && !ex.devIntroducedNewTopic && !ex.devAskedQuestion) {
      noDelegationCount++;
    }

    if (ex.aiProposedMultipleOptions && !ex.devRespondedToAllOptions) {
      // Build a description of the ignored proposal
      const devSummary = ex.devEvent.content.summary;
      ignoredProposals.push(
        `Exchange at event ${ex.devEvent.causalOrder}: dev said "${devSummary}" without addressing all options`,
      );
    }
  }

  return {
    promptSections: {
      // 70%+ exchanges have devResponseChars < 15
      detectPassiveAcceptance: shortResponseCount / total >= 0.7,
      // Majority of exchanges show passive delegation (no reasoning, no new topics, no questions)
      trackDelegation: noDelegationCount / total > 0.5,
      // any exchange has aiProposedMultipleOptions && !devRespondedToAllOptions
      detectIgnoredProposals: ignoredProposals.length > 0,
      // Session contains learning-oriented exchanges (questions asked)
      isLearningExchange: questionCount > 0,
    },
    exchangeSummary: {
      totalExchanges: total,
      shortResponseCount,
      questionCount,
      reasoningCount,
      newTopicCount,
      ignoredProposals,
    },
  };
}
