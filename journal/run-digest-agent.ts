#!/usr/bin/env npx tsx
/**
 * run-digest-agent.ts — digest a CC session using the agent arm
 *
 * Usage:
 *   npx tsx run-digest-agent.ts <path-to-session.jsonl> [--force]
 *
 * DEPRECATED (Slice 4): Session digestion has moved to the Python backend.
 * Use: python3 -m quire.cli journal digest <log-path>
 * Emergency bypass: npx tsx run-digest-agent.ts --force-legacy <path>
 */

import { digestWithAgent } from "./src/agents/digest/run.js";

const args = process.argv.slice(2);
const forceFlag = args.includes("--force");
const forceLegacy = args.includes("--force-legacy");
const pathArgs = args.filter((a) => !a.startsWith("--"));

// ── Deprecation gate (Slice 4) ─────────────────────────────────────────────
// Session digestion has moved to the Python backend (single-writer rule).
// Use: python3 -m quire.cli journal digest <log-path>
// --force-legacy bypasses this for emergencies only.
if (!forceLegacy) {
  process.stderr.write(
    "DEPRECATED: TS agent digest has moved to the Python backend.\n" +
    "Use: python3 -m quire.cli journal digest <log-path>\n" +
    "     python3 -m quire.cli journal digest --force <log-path>  (re-digest)\n" +
    "Emergency bypass (not recommended): npx tsx run-digest-agent.ts --force-legacy <path>\n",
  );
  process.exit(1);
}

if (pathArgs.length === 0) {
  console.error("Usage: npx tsx run-digest-agent.ts --force-legacy <path> [--force]");
  process.exit(1);
}

const logPath = pathArgs[0]!;

async function main() {
  try {
    console.log(`Digesting: ${logPath}${forceFlag ? " (--force)" : ""}`);
    const result = await digestWithAgent(logPath, { force: forceFlag });
    const sittingCount = Array.from(
      new Set((result.moments as Array<{ chunkId?: string }>).map((m) => m.chunkId))
    ).length;
    const eventsEmitted = (result as { _eventsEmitted?: number })._eventsEmitted ?? 0;
    console.log(
      `stored digest ${result.sessionId} (${result.moments.length} moments, ${sittingCount} sittings) + emitted ${eventsEmitted} events`,
    );
  } catch (err) {
    console.error("Error:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
