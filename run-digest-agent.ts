#!/usr/bin/env npx tsx
/**
 * run-digest-agent.ts — digest a CC session using the agent arm
 *
 * Usage:
 *   npx tsx run-digest-agent.ts <path-to-session.jsonl> [--force]
 */

import { digestWithAgent } from "./src/agents/digest/run.js";

const args = process.argv.slice(2);
const forceFlag = args.includes("--force");
const pathArgs = args.filter((a) => !a.startsWith("--"));

if (pathArgs.length === 0) {
  console.error("Usage: npx tsx run-digest-agent.ts <path> [--force]");
  process.exit(1);
}

const logPath = pathArgs[0]!;

async function main() {
  try {
    console.log(`Digesting: ${logPath}${forceFlag ? " (--force)" : ""}`);
    const result = await digestWithAgent(logPath, { force: forceFlag });
    console.log(`\nDone. sessionId: ${result.sessionId}`);
    console.log(`  Moments: ${result.moments.length}`);
    console.log(`  Transitions: ${result.transitions.length}`);
    console.log(`  Outcomes: ${result.outcomes.length}`);
    console.log(`  Narrative: ${result.narrative.summary.slice(0, 100)}...`);
  } catch (err) {
    console.error("Error:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
