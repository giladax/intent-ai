import 'dotenv/config';
import { parseClaudeCodeLog } from './src/adapters/claude-code.js';
import { normalize } from './src/pipeline/normalize.js';
import { chunkSession } from './src/pipeline/chunk.js';
import { classifySession } from './src/pipeline/classify.js';
import { analyzeInteractions } from './src/pipeline/analyze.js';
import { detectMoments } from './src/pipeline/moments.js';
import { detectTransitionsAndOutcomes } from './src/pipeline/transitions.js';
import { generateNarrative } from './src/pipeline/narrative.js';
import { randomUUID } from 'crypto';
import { designScope } from './tests/eval/session-criteria.js';
import { scorePipelineOutput } from './src/eval/fitness.js';
import type { ScopeCriteria } from './tests/eval/session-criteria.js';
import type {
  SessionMoment,
  SessionNarrative,
  PipelineDirectives,
} from './src/adapters/types.js';

const FIXTURE_PATH = 'tests/eval/fixtures/scope-design.jsonl';

async function main() {
  const criteria: ScopeCriteria = designScope;
  const sessionId = randomUUID();

  console.log('Loading fixture...');
  const startTime = Date.now();

  let moments: SessionMoment[] = [];
  let narrative: SessionNarrative;
  let directives: PipelineDirectives;

  try {
    // Step 1: Parse
    const rawEvents = await parseClaudeCodeLog(FIXTURE_PATH);
    console.log(`  Parsed ${rawEvents.length} raw events`);

    // Step 2: Normalize
    const normalized = normalize(rawEvents, sessionId);
    console.log(`  Normalized to ${normalized.length} events`);

    // Step 3: Chunk
    const chunks = chunkSession(normalized, sessionId);
    console.log(`  Chunked into ${chunks.length} chunks`);

    // Step 4: Classify session shape
    console.log('  Classifying session shape...');
    const sessionShape = await classifySession(normalized);
    console.log(`  Shape: ${sessionShape}`);

    // Step 5: Analyze interactions (deterministic)
    directives = analyzeInteractions(normalized);
    console.log(`  Directives computed (${directives.exchangeSummary.totalExchanges} exchanges)`);

    // Step 6: Detect moments (LLM)
    console.log('  Detecting moments...');
    moments = await detectMoments(chunks, sessionShape, directives);
    console.log(`  Found ${moments.length} moments`);

    // Step 7: Detect transitions & outcomes (LLM)
    console.log('  Detecting transitions & outcomes...');
    const { transitions, outcomes } = await detectTransitionsAndOutcomes(moments, sessionId);
    console.log(`  Found ${transitions.length} transitions, ${outcomes.length} outcomes`);

    // Step 8: Generate narrative (LLM)
    console.log('  Generating narrative...');
    narrative = await generateNarrative(moments, transitions, outcomes, sessionShape);
    console.log('  Narrative generated');
  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`\nPipeline FAILED after ${elapsed}s:`);
    console.error(err);
    console.log('\n--- SCORE: 0 (pipeline error) ---');
    process.exit(1);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Score
  const result = scorePipelineOutput(criteria, moments, narrative, directives);

  // ── Print Report ────────────────────────────────────────────────────
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const check = (ok: boolean) => (ok ? 'v' : 'x');

  console.log('');
  console.log('=== Gen 0 Fitness Report ================================================');
  console.log(`Chromosome: current (threaded exchanges)`);
  console.log(`Fixture: scope-design.jsonl (257 lines)`);
  console.log(`Time: ${elapsed}s`);
  console.log('');

  // Moments Detected
  const totalMoments = criteria.mustDetectMoments.length;
  const detectedCount = totalMoments - result.details.missingMoments.length;
  console.log(`Moments Detected:    ${detectedCount}/${totalMoments} (${pct(result.scores.momentsDetected)})`);

  for (const expected of criteria.mustDetectMoments) {
    const key = `${expected.topic} / ${expected.type}`;
    const found = !result.details.missingMoments.includes(key);
    console.log(`  ${check(found)} ${key}${found ? '' : ' -- NOT FOUND'}`);
  }

  console.log('');

  // Moments Correct
  if (result.details.falsePositives.length === 0) {
    console.log(`Moments Correct:     ${pct(result.scores.momentsCorrect)} (no false positives)`);
  } else {
    console.log(`Moments Correct:     ${pct(result.scores.momentsCorrect)}`);
    for (const fp of result.details.falsePositives) {
      console.log(`  x ${fp}`);
    }
  }

  console.log('');

  // Narrative Musts
  const narrativeTotal = criteria.narrativeMusts.length;
  const narrativeFound = narrativeTotal - result.details.missingNarrativePhrases.length;
  console.log(`Narrative Musts:     ${narrativeFound}/${narrativeTotal} (${pct(result.scores.narrativeMusts)})`);

  for (const phrase of criteria.narrativeMusts) {
    const found = !result.details.missingNarrativePhrases.includes(phrase);
    console.log(`  ${check(found)} "${phrase}"${found ? '' : ' -- NOT FOUND'}`);
  }

  console.log('');

  // Narrative Must-Nots
  if (result.details.badNarrativePhrases.length === 0) {
    console.log(`Narrative Must-Nots: ${pct(result.scores.narrativeMustNots)} (none found -- good)`);
  } else {
    console.log(`Narrative Must-Nots: ${pct(result.scores.narrativeMustNots)}`);
    for (const phrase of result.details.badNarrativePhrases) {
      console.log(`  x "${phrase}" -- FOUND (bad)`);
    }
  }

  console.log('');

  // Directives
  const expectedDirs = criteria.expectedDirectives;
  const actualDirs = directives.promptSections;
  const dirFlags: [string, boolean, boolean][] = [
    ['detectPassiveAcceptance', expectedDirs.detectPassiveAcceptance, actualDirs.detectPassiveAcceptance],
    ['trackDelegation', expectedDirs.trackDelegation, actualDirs.trackDelegation],
    ['detectIgnoredProposals', expectedDirs.detectIgnoredProposals, actualDirs.detectIgnoredProposals],
    ['isLearningExchange', expectedDirs.isLearningExchange, actualDirs.isLearningExchange],
  ];
  const dirMatch = dirFlags.filter(([, e, a]) => e === a).length;
  console.log(`Directives:          ${dirMatch}/${dirFlags.length} (${pct(result.scores.directivesCorrect)})`);

  for (const [name, expected, actual] of dirFlags) {
    const match = expected === actual;
    console.log(`  ${check(match)} ${name}: expected=${expected}, got=${actual}`);
  }

  console.log('');

  // Total
  console.log(`TOTAL SCORE: ${pct(result.totalScore)}`);

  // Moment details for debugging
  console.log('');
  console.log('--- Detected Moments (for debugging) ---');
  for (const m of moments) {
    console.log(`  [${m.type}] ${m.topicFingerprint}: ${m.statement.slice(0, 100)}`);
  }

  console.log('');
  console.log('--- Narrative Summary ---');
  console.log(narrative.summary.slice(0, 500));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
