import "dotenv/config";
import { designScope } from "./tests/eval/session-criteria.js";
import { judgeOutput } from "./src/eval/judge.js";
import { parseClaudeCodeLog } from "./src/adapters/claude-code.js";
import { normalize } from "./src/pipeline/normalize.js";
import { classifySession } from "./src/pipeline/classify.js";
import { chunkSession } from "./src/pipeline/chunk.js";
import { detectMomentsWithOrganism } from "./src/eval/organism.js";
import { randomUUID } from "crypto";

// Alleles
import { hunter, scorer } from "./src/eval/chromosomes/chr1-instructions.js";
import { hybrid } from "./src/eval/chromosomes/chr2-formats.js";
import { conversationOnly } from "./src/eval/chromosomes/chr4-data.js";
import { fullPrecompute } from "./src/eval/chromosomes/chr3-synthesis.js";
import type { Organism } from "./src/eval/chromosomes/types.js";

const FIXTURE = "tests/eval/fixtures/scope-design.jsonl";

async function main() {
  console.log("═══ Phase 4: Instructions (Chr 1) ═══");
  console.log("Hold: {2f_hybrid, 3c_full_precompute, 4a_conversation}");
  console.log("Fixture: scope-design.jsonl\n");

  // Parse once, reuse
  const rawEvents = await parseClaudeCodeLog(FIXTURE);
  const sessionId = randomUUID();
  const normalizedEvents = normalize(rawEvents, sessionId);
  const sessionShape = await classifySession(normalizedEvents);
  const chunks = chunkSession(normalizedEvents, sessionId);

  console.log(`  ${rawEvents.length} raw → ${normalizedEvents.length} normalized → ${chunks.length} chunks`);
  console.log(`  Shape: ${sessionShape}\n`);

  const organisms: Organism[] = [
    { name: "1a_hunter", instructions: hunter, format: hybrid, synthesis: fullPrecompute, dataSelection: conversationOnly },
    { name: "1b_scorer", instructions: scorer, format: hybrid, synthesis: fullPrecompute, dataSelection: conversationOnly },
  ];

  for (const org of organisms) {
    const start = Date.now();
    console.log(`  Running ${org.name}...`);

    try {
      const moments = await detectMomentsWithOrganism(org, rawEvents, chunks, sessionShape, normalizedEvents);
      console.log(`    ${moments.length} moments detected (${((Date.now() - start) / 1000).toFixed(1)}s)`);

      console.log(`    Judging...`);
      const mockNarrative = {
        sessionId,
        sessionShape,
        summary: moments.map(m => m.statement).join(". "),
        progression: moments.map(m => m.statement),
        discoveries: moments.filter(m => m.type === "discovery").map(m => m.statement),
        stabilizedDirections: moments.filter(m => m.type === "commitment").map(m => m.statement),
        abandonedDirections: [],
        arcs: [],
      };

      const score = await judgeOutput(designScope, moments, mockNarrative);
      console.log(`    Score: ${score.overall.toFixed(2)}/5`);
      console.log(`    Coverage: ${score.momentCoverage.score}/5 — ${score.momentCoverage.reasoning.slice(0, 120)}`);
      console.log(`    Quality:  ${score.momentQuality.score}/5 — ${score.momentQuality.reasoning.slice(0, 120)}`);
      console.log(`    Insight:  ${score.narrativeInsight.score}/5 — ${score.narrativeInsight.reasoning.slice(0, 120)}`);
      console.log();
    } catch (err) {
      console.log(`    FAILED: ${err instanceof Error ? err.message.slice(0, 150) : String(err)}`);
      console.log();
    }
  }
}

main().catch(console.error);
