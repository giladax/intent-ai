/**
 * Eval criteria for the threading-session.jsonl fixture.
 *
 * These define "what correct looks like" for the causal threading
 * pipeline. Subsequent tasks implement against these expectations.
 *
 * The fixture contains 15 raw JSONL entries that the adapter expands
 * into 19 RawDevEvents. After normalization with causal threading,
 * each event gets a causalOrder, category, turnId, and respondingTo.
 */

// ── Expected threading (causal chain) ──────────────────────────────
// Each entry maps a causalOrder to its expected category, turnId source,
// and which prior event it responds to.
//
// Raw event breakdown:
//   0:  u-001          conversation_turn  (user question)
//   1:  a-001-text-0   ai_response
//   2:  a-001-tool-1   tool_call (Read auth.ts)
//   3:  a-001-tool-2   tool_call (Read index.ts)
//   4:  u-002-result-0 tool_result
//   5:  u-002-result-1 tool_result
//   6:  a-002-text-0   ai_response (reflection)
//   7:  u-003          conversation_turn  ("ok")
//   8:  a-003-text-0   ai_response (proposes A and B)
//   9:  u-004          conversation_turn  ("let's do A")
//  10:  a-004-text-0   ai_response
//  11:  a-004-tool-1   tool_call (Edit)
//  12:  u-005-result-0 tool_result
//  13:  a-005-text-0   ai_response (confirmation)
//  14:  u-006          conversation_turn  (challenge with reasoning)
//  15:  a-006-text-0   ai_response (acknowledge + revert)
//  16:  a-006-tool-1   tool_call (Edit revert)
//  17:  u-007-result-0 tool_result
//  18:  a-007-text-0   ai_response (follow-up)

export const expectedThreading: Array<{
  causalOrder: number;
  category: string;
  turnIdPrefix: string;
  respondingToCausalOrder: number | null;
}> = [
  // User asks initial question
  { causalOrder: 0, category: "intent", turnIdPrefix: "u-001", respondingToCausalOrder: null },
  // AI responds: text + 2 tool reads (all same turn, responding to user question)
  { causalOrder: 1, category: "reflection", turnIdPrefix: "a-001", respondingToCausalOrder: 0 },
  { causalOrder: 2, category: "action", turnIdPrefix: "a-001", respondingToCausalOrder: 0 },
  { causalOrder: 3, category: "action", turnIdPrefix: "a-001", respondingToCausalOrder: 0 },
  // Tool results come back (responding to the tool calls)
  { causalOrder: 4, category: "result", turnIdPrefix: "u-002", respondingToCausalOrder: 2 },
  { causalOrder: 5, category: "result", turnIdPrefix: "u-002", respondingToCausalOrder: 3 },
  // AI reflects on findings (responding to tool results, same logical turn)
  { causalOrder: 6, category: "reflection", turnIdPrefix: "a-002", respondingToCausalOrder: 4 },
  // User says "ok" — passive acceptance
  { causalOrder: 7, category: "intent", turnIdPrefix: "u-003", respondingToCausalOrder: 6 },
  // AI proposes two options
  { causalOrder: 8, category: "proposal", turnIdPrefix: "a-003", respondingToCausalOrder: 7 },
  // User picks option A only
  { causalOrder: 9, category: "intent", turnIdPrefix: "u-004", respondingToCausalOrder: 8 },
  // AI implements option A
  { causalOrder: 10, category: "reflection", turnIdPrefix: "a-004", respondingToCausalOrder: 9 },
  { causalOrder: 11, category: "action", turnIdPrefix: "a-004", respondingToCausalOrder: 9 },
  // Tool result
  { causalOrder: 12, category: "result", turnIdPrefix: "u-005", respondingToCausalOrder: 11 },
  // AI confirms done
  { causalOrder: 13, category: "reflection", turnIdPrefix: "a-005", respondingToCausalOrder: 12 },
  // User challenges with reasoning (topic shift)
  { causalOrder: 14, category: "intent", turnIdPrefix: "u-006", respondingToCausalOrder: 13 },
  // AI acknowledges and reverts
  { causalOrder: 15, category: "reflection", turnIdPrefix: "a-006", respondingToCausalOrder: 14 },
  { causalOrder: 16, category: "action", turnIdPrefix: "a-006", respondingToCausalOrder: 14 },
  // Tool result for revert
  { causalOrder: 17, category: "result", turnIdPrefix: "u-007", respondingToCausalOrder: 16 },
  // AI follow-up
  { causalOrder: 18, category: "reflection", turnIdPrefix: "a-007", respondingToCausalOrder: 17 },
];

// ── Expected exchanges ─────────────────────────────────────────────
// Each exchange pairs a developer message (conversation_turn) with
// the AI events that follow until the next developer message.
//
// Exchange 0: "How does the auth middleware work?" → AI reads files + reflects
// Exchange 1: "ok" → AI proposes options A and B
// Exchange 2: "let's do A" → AI implements, confirms
// Exchange 3: challenge with reasoning → AI reverts, explains

export const expectedExchanges: Array<{
  devCausalOrder: number;
  aiTurnEventCount: number;
  devResponseChars: number;
  devAskedQuestion: boolean;
  devUsedReasoning: boolean;
  devIntroducedNewTopic: boolean;
  aiProposedMultipleOptions: boolean;
  devRespondedToAllOptions: boolean;
}> = [
  {
    devCausalOrder: 0,
    aiTurnEventCount: 6, // a-001 text + 2 tools + 2 tool_results + a-002 reflection
    devResponseChars: 38, // "How does the auth middleware work?"
    devAskedQuestion: true,
    devUsedReasoning: false,
    devIntroducedNewTopic: false, // first message, establishes topic
    aiProposedMultipleOptions: false,
    devRespondedToAllOptions: false, // N/A — no options proposed
  },
  {
    devCausalOrder: 7,
    aiTurnEventCount: 1, // a-003 text (proposes options)
    devResponseChars: 2, // "ok"
    devAskedQuestion: false,
    devUsedReasoning: false,
    devIntroducedNewTopic: false,
    aiProposedMultipleOptions: false, // AI before this exchange didn't propose options; the AI *in this exchange's response* proposes them
    devRespondedToAllOptions: false, // N/A
  },
  {
    devCausalOrder: 9,
    aiTurnEventCount: 4, // a-004 text + tool + u-005 result + a-005 text
    devResponseChars: 10, // "let's do A"
    devAskedQuestion: false,
    devUsedReasoning: false,
    devIntroducedNewTopic: false,
    aiProposedMultipleOptions: true, // prior AI (a-003) proposed A and B
    devRespondedToAllOptions: false, // only addressed option A
  },
  {
    devCausalOrder: 14,
    aiTurnEventCount: 4, // a-006 text + tool + u-007 result + a-007 text
    devResponseChars: 95, // approximate length of challenge message
    devAskedQuestion: false,
    devUsedReasoning: true, // "because the middleware is used by 3 other services"
    devIntroducedNewTopic: true, // shifts from refactoring to testing
    aiProposedMultipleOptions: false,
    devRespondedToAllOptions: false, // N/A
  },
];

// ── Expected pipeline directives ───────────────────────────────────
// Aggregated from exchange analysis.

export const expectedDirectives: {
  promptSections: {
    detectPassiveAcceptance: boolean;
    trackDelegation: boolean;
    detectIgnoredProposals: boolean;
    isLearningExchange: boolean;
  };
} = {
  promptSections: {
    // 1 out of 4 exchanges has short response (25%) — below threshold
    detectPassiveAcceptance: false,
    // developer mostly directs, doesn't fully delegate
    trackDelegation: false,
    // "let's do A" ignores option B
    detectIgnoredProposals: true,
    // initial question "how does the auth middleware work?" is learning
    isLearningExchange: true,
  },
};
