import type { ScopeCriteria } from '../../tests/eval/session-criteria.js';
import type {
  SessionMoment,
  SessionNarrative,
  PipelineDirectives,
} from '../adapters/types.js';

export interface FitnessResult {
  chromosomeName: string;
  fixture: string;
  scores: {
    momentsDetected: number;
    momentsCorrect: number;
    narrativeMusts: number;
    narrativeMustNots: number;
    directivesCorrect: number;
  };
  totalScore: number;
  tokensUsed: number;
  costEstimate: number;
  details: {
    missingMoments: string[];
    falsePositives: string[];
    missingNarrativePhrases: string[];
    badNarrativePhrases: string[];
  };
}

export function scorePipelineOutput(
  criteria: ScopeCriteria,
  moments: SessionMoment[],
  narrative: SessionNarrative,
  directives: PipelineDirectives,
): Omit<FitnessResult, 'chromosomeName' | 'fixture' | 'tokensUsed' | 'costEstimate'> {
  // ── Moments Detected ────────────────────────────────────────────────
  const missingMoments: string[] = [];
  let momentsMatched = 0;

  for (const expected of criteria.mustDetectMoments) {
    const found = moments.some((m) => {
      // Type must match
      if (m.type !== expected.type) return false;

      // If containsPhrase is specified, check if statement contains it
      if (expected.containsPhrase) {
        return m.statement.toLowerCase().includes(expected.containsPhrase.toLowerCase());
      }

      // No containsPhrase — check if statement is topically related
      // by looking for keywords from the topic field
      const topicKeywords = expected.topic
        .toLowerCase()
        .split(/[-_\s]+/)
        .filter((w) => w.length > 2);

      return topicKeywords.some((keyword) =>
        m.statement.toLowerCase().includes(keyword) ||
        m.topicFingerprint.toLowerCase().includes(keyword),
      );
    });
    if (found) {
      momentsMatched++;
    } else {
      missingMoments.push(`${expected.topic} / ${expected.type}`);
    }
  }

  const momentsDetected =
    criteria.mustDetectMoments.length > 0
      ? momentsMatched / criteria.mustDetectMoments.length
      : 1;

  // ── Moments Correct (no false positives) ────────────────────────────
  const falsePositives: string[] = [];

  for (const moment of moments) {
    for (const antiPhrase of criteria.mustNotDetect) {
      if (moment.statement.toLowerCase().includes(antiPhrase.toLowerCase())) {
        falsePositives.push(`"${moment.statement}" contains "${antiPhrase}"`);
      }
    }
  }

  const momentsCorrect =
    moments.length > 0
      ? (moments.length - falsePositives.length) / moments.length
      : 1;

  // ── Narrative Musts ─────────────────────────────────────────────────
  const narrativeText = [
    narrative.summary,
    ...narrative.progression,
    ...narrative.discoveries,
  ]
    .join(' ')
    .toLowerCase();

  const missingNarrativePhrases: string[] = [];
  let narrativeMatched = 0;

  for (const phrase of criteria.narrativeMusts) {
    if (narrativeText.includes(phrase.toLowerCase())) {
      narrativeMatched++;
    } else {
      missingNarrativePhrases.push(phrase);
    }
  }

  const narrativeMusts =
    criteria.narrativeMusts.length > 0
      ? narrativeMatched / criteria.narrativeMusts.length
      : 1;

  // ── Narrative Must-Nots ─────────────────────────────────────────────
  const badNarrativePhrases: string[] = [];

  for (const antiPhrase of criteria.narrativeMustNots) {
    if (narrativeText.includes(antiPhrase.toLowerCase())) {
      badNarrativePhrases.push(antiPhrase);
    }
  }

  const narrativeMustNots =
    criteria.narrativeMustNots.length > 0
      ? (criteria.narrativeMustNots.length - badNarrativePhrases.length) /
        criteria.narrativeMustNots.length
      : 1;

  // ── Directives Correct ──────────────────────────────────────────────
  const expectedDirs = criteria.expectedDirectives;
  const actualDirs = directives.promptSections;
  const dirFlags: [string, boolean, boolean][] = [
    ['detectPassiveAcceptance', expectedDirs.detectPassiveAcceptance, actualDirs.detectPassiveAcceptance],
    ['trackDelegation', expectedDirs.trackDelegation, actualDirs.trackDelegation],
    ['detectIgnoredProposals', expectedDirs.detectIgnoredProposals, actualDirs.detectIgnoredProposals],
    ['isLearningExchange', expectedDirs.isLearningExchange, actualDirs.isLearningExchange],
  ];

  let dirMatched = 0;
  for (const [, expected, actual] of dirFlags) {
    if (expected === actual) dirMatched++;
  }

  const directivesCorrect = dirFlags.length > 0 ? dirMatched / dirFlags.length : 1;

  // ── Total Score ─────────────────────────────────────────────────────
  const totalScore =
    momentsDetected * 0.3 +
    momentsCorrect * 0.1 +
    narrativeMusts * 0.3 +
    narrativeMustNots * 0.1 +
    directivesCorrect * 0.2;

  return {
    scores: {
      momentsDetected,
      momentsCorrect,
      narrativeMusts,
      narrativeMustNots,
      directivesCorrect,
    },
    totalScore,
    details: {
      missingMoments,
      falsePositives,
      missingNarrativePhrases,
      badNarrativePhrases,
    },
  };
}
