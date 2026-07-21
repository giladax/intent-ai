import type { SessionState, BatchDigest, PromptSuggestion } from './types.js';

const MAX_RECENT_DIGESTS = 5;
const MAX_SIGNIFICANT = 20;

export function createSessionState(sessionId: string, transcriptPath: string): SessionState {
  return {
    sessionId,
    startedAt: Date.now(),
    transcriptPath,
    turnCount: 0,
    currentIntent: '',
    intentHistory: [],
    filesInFocus: [],
    toolsUsed: {},
    recentDigests: [],
    openQuestions: [],
    significantEvents: [],
    latestSuggestion: null,
  };
}

export function updateSessionState(state: SessionState, digest: BatchDigest): SessionState {
  // Track intent changes
  const intentHistory = digest.currentIntent !== state.currentIntent
    ? [...state.intentHistory, digest.currentIntent]
    : state.intentHistory;

  // Merge files
  const filesInFocus = [...new Set([...digest.filesInFocus])];

  // Sliding window of recent digests
  const recentDigests = [...state.recentDigests, digest].slice(-MAX_RECENT_DIGESTS);

  // Track significant events
  const significantEvents = digest.significantEvent
    ? [...state.significantEvents, digest.summary].slice(-MAX_SIGNIFICANT)
    : state.significantEvents;

  return {
    ...state,
    turnCount: state.turnCount + 1,
    currentIntent: digest.currentIntent,
    intentHistory,
    filesInFocus,
    recentDigests,
    openQuestions: digest.openQuestions,
    significantEvents,
  };
}
