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
import { hunter } from "./src/eval/chromosomes/chr1-instructions.js";
import { flat, behavioral, hybrid, annotatedFlat } from "./src/eval/chromosomes/chr2-formats.js";
import { fullPrecompute } from "./src/eval/chromosomes/chr3-synthesis.js";
import { conversationOnly } from "./src/eval/chromosomes/chr4-data.js";
import type { Organism } from "./src/eval/chromosomes/types.js";

const FIXTURE = "tests/eval/fixtures/scope-design.jsonl";

async function main() {
  console.log("═══ Crossover: Parents + Offspring ═══\n");

  // Parse once, reuse
  const rawEvents = await parseClaudeCodeLog(FIXTURE);
  const sessionId = randomUUID();
  const normalizedEvents = normalize(rawEvents, sessionId);
  const sessionShape = await classifySession(normalizedEvents);
  const chunks = chunkSession(normalizedEvents, sessionId);

  console.log(`  ${rawEvents.length} raw → ${normalizedEvents.length} normalized → ${chunks.length} chunks`);
  console.log(`  Shape: ${sessionShape}\n`);

  const organisms: Organism[] = [
    { name: "2a_flat (parent)", instructions: hunter, format: flat, synthesis: fullPrecompute, dataSelection: conversationOnly },
    { name: "2c_behavioral (parent)", instructions: hunter, format: behavioral, synthesis: fullPrecompute, dataSelection: conversationOnly },
    { name: "2f_hybrid (offspring)", instructions: hunter, format: hybrid, synthesis: fullPrecompute, dataSelection: conversationOnly },
    { name: "2g_annotated_flat (offspring)", instructions: hunter, format: annotatedFlat, synthesis: fullPrecompute, dataSelection: conversationOnly },
  ];

  const results: { name: string; moments: any[]; score: any }[] = [];

  for (const org of organisms) {
    const start = Date.now();
    console.log(`  Running ${org.name}...`);

    try {
      const moments = await detectMomentsWithOrganism(org, rawEvents, chunks, sessionShape, normalizedEvents);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`    ${moments.length} moments detected (${elapsed}s)`);

      for (const m of moments) {
        console.log(`    [${m.type}] ${m.topicFingerprint} — agency:${m.agency} — "${m.statement.slice(0, 120)}"`);
      }

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
      console.log(`    Coverage: ${score.momentCoverage.score}/5 — found: [${score.momentCoverage.found.join(", ")}]`);
      console.log(`    Coverage missed: [${score.momentCoverage.missed.join(", ")}]`);
      console.log(`    Quality: ${score.momentQuality.score}/5 — ${score.momentQuality.reasoning.slice(0, 120)}`);
      console.log(`    Narrative Accuracy: ${score.narrativeAccuracy.score}/5`);
      console.log(`    Narrative Insight: ${score.narrativeInsight.score}/5`);
      console.log(`    Anti-patterns: ${score.antiPatterns.score}/5`);
      console.log();

      results.push({ name: org.name, moments, score });
    } catch (err) {
      console.log(`    FAILED: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`);
      console.log();
    }
  }

  // Final summary
  console.log("═══ Crossover Results ═══\n");
  for (const r of results) {
    console.log(`${r.name}: ${r.score.overall.toFixed(2)}/5 (${r.moments.length} moments)`);
    console.log(`  Coverage=${r.score.momentCoverage.score} Quality=${r.score.momentQuality.score} NarrAcc=${r.score.narrativeAccuracy.score} NarrIns=${r.score.narrativeInsight.score} Anti=${r.score.antiPatterns.score}`);
  }
}

main().catch(console.error);
