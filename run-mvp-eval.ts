import "dotenv/config";
import * as fs from "fs";
import { mvpTasks, getTask } from "./src/eval/mvp-task-criteria.js";
import {
  scoreSession,
  aggregate,
  evaluatePassBar,
  type Arm,
  type SessionInput,
  type SessionScore,
  type TaskArmStats,
  type PassBarResult,
} from "./src/eval/mvp-eval.js";

/**
 * MVP measurement A/B runner (Brain PRD v0.3, §Measurement harness).
 *
 * Arms: { baseline, treatment } × 5 tasks × N=3 = 30 sessions.
 * Prints the per-task comparison table and evaluates the pre-registered pass
 * bar + kill switch.
 *
 * STATUS: harness mechanics only. The live A/B requires the WS-A Brain MCP
 * treatment to exist before the `treatment` arm can be COLLECTED. Sessions are
 * fed in from a manifest (recorded runs); see `collectSession` for the single
 * stub point where WS-A plugs in.
 *
 * Usage:
 *   npx tsx run-mvp-eval.ts --manifest <sessions.json>   # score recorded runs
 *   npx tsx run-mvp-eval.ts                               # explains what's missing
 */

const N = 3;
const ARMS: Arm[] = ["baseline", "treatment"];

// ─────────────────────────────────────────────────────────────────────
// TREATMENT/BASELINE COLLECTION STUB — THIS IS WHERE WS-A PLUGS IN.
//
// Once WS-A's Brain MCP treatment exists, implement live collection here:
//   - baseline arm:   Claude Code + .repo/brain.md + CLAUDE.md, MCP disabled
//   - treatment arm:  identical repo+task, Brain MCP enabled, brain.enter first
// Hold model/prompt/temperature/commit constant; vary only the context source.
// Each run must produce: transcript JSONL path, final diff, tsc + test result.
// ─────────────────────────────────────────────────────────────────────
function collectSession(taskId: string, arm: Arm, run: number): SessionInput {
  throw new Error(
    `collectSession not implemented (task=${taskId} arm=${arm} run=${run}). ` +
      `Live A/B collection requires the WS-A Brain MCP treatment. Until then, ` +
      `run recorded sessions via --manifest <sessions.json>.`,
  );
}

// ── Manifest loading ─────────────────────────────────────────────────

const SessionInputKeys: (keyof SessionInput)[] = [
  "taskId",
  "arm",
  "run",
  "transcriptPath",
  "diff",
  "tscPassed",
  "testPassed",
];

function loadManifest(path: string): SessionInput[] {
  const raw = JSON.parse(fs.readFileSync(path, "utf-8"));
  if (!Array.isArray(raw)) {
    throw new Error("Manifest must be a JSON array of SessionInput objects");
  }
  for (const [i, s] of raw.entries()) {
    for (const k of SessionInputKeys) {
      if (!(k in s)) {
        throw new Error(`Manifest entry ${i} missing required field "${k}"`);
      }
    }
    if (!getTask(s.taskId)) {
      throw new Error(`Manifest entry ${i} references unknown task "${s.taskId}"`);
    }
  }
  return raw as SessionInput[];
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const manifestIdx = args.indexOf("--manifest");
  const manifestPath = manifestIdx >= 0 ? args[manifestIdx + 1] : undefined;

  console.log("=== MVP Measurement A/B (Brain PRD v0.3) ===");
  console.log(`Arms: ${ARMS.join(", ")} | Tasks: ${mvpTasks.length} | N=${N}`);
  console.log("");

  let inputs: SessionInput[];
  if (manifestPath) {
    inputs = loadManifest(manifestPath);
    console.log(`Loaded ${inputs.length} recorded sessions from ${manifestPath}`);
  } else {
    console.log("No --manifest provided. The live A/B is not yet runnable:");
    console.log("");
    try {
      collectSession(mvpTasks[0].id, "treatment", 1);
    } catch (err) {
      console.log(`  ${err instanceof Error ? err.message : String(err)}`);
    }
    console.log("");
    console.log("Provide recorded runs with: npx tsx run-mvp-eval.ts --manifest <sessions.json>");
    console.log("Each entry: { taskId, arm, run, transcriptPath, diff, tscPassed, testPassed }");
    return;
  }

  console.log("Scoring sessions (ETC deterministic; CVR + correctness via Haiku)...\n");
  const scores: SessionScore[] = [];
  for (const input of inputs) {
    const task = getTask(input.taskId)!;
    const score = await scoreSession(task, input);
    scores.push(score);
    process.stderr.write(
      `  [${score.taskId}/${score.arm}#${score.run}] ETC=${score.etc} ` +
        `viol=${score.violations} success=${score.success}\n`,
    );
  }

  const stats = aggregate(scores);
  printComparisonTable(stats);

  const verdict = evaluatePassBar(stats);
  printVerdict(verdict);
}

// ── Output ───────────────────────────────────────────────────────────

function printComparisonTable(stats: TaskArmStats[]) {
  const byKey = new Map(stats.map((s) => [`${s.taskId}::${s.arm}`, s]));
  const taskIds = [...new Set(stats.map((s) => s.taskId))].sort();

  console.log("");
  console.log("=== A/B Results ======================================================");
  console.log("");
  console.log(
    "Task     | base ETC (min/med/max) | treat ETC (min/med/max) | base CVR | treat CVR | base ok | treat ok",
  );
  console.log(
    "---------+------------------------+-------------------------+----------+-----------+---------+---------",
  );

  const fmtEtc = (s?: TaskArmStats) =>
    s ? `${s.etcMin}/${s.etcMedian}/${s.etcMax}` : "-/-/-";

  for (const taskId of taskIds) {
    const base = byKey.get(`${taskId}::baseline`);
    const treat = byKey.get(`${taskId}::treatment`);
    console.log(
      `${taskId.padEnd(8)} | ${fmtEtc(base).padEnd(22)} | ${fmtEtc(treat).padEnd(23)} | ` +
        `${String(base?.cvrTotal ?? 0).padEnd(8)} | ${String(treat?.cvrTotal ?? 0).padEnd(9)} | ` +
        `${String(base?.successCount ?? 0).padEnd(7)} | ${String(treat?.successCount ?? 0)}`,
    );
  }
  console.log("");
}

function printVerdict(v: PassBarResult) {
  console.log("=== Pre-registered Pass Bar ==========================================");
  console.log("");
  console.log("Per-task ETC ratio (treatment/baseline; target <= 0.7):");
  for (const t of v.perTask) {
    const ratio = Number.isFinite(t.etcRatio) ? t.etcRatio.toFixed(2) : "inf";
    console.log(
      `  ${t.taskId.padEnd(8)} ${ratio.padStart(5)}  ${t.etcImproved ? "PASS" : "----"}`,
    );
  }
  console.log("");
  console.log(
    `  ETC criterion (>=3/5 tasks <=0.7x):       ${v.etcCriterionMet ? "PASS" : "FAIL"} ` +
      `(${v.etcImprovedTasks.length}/5: ${v.etcImprovedTasks.join(", ") || "none"})`,
  );
  console.log(
    `  CVR criterion (base>=2 & treat==0):       ${v.cvrCriterionMet ? "PASS" : "FAIL"} ` +
      `(base=${v.baselineCvrTotal}, treat=${v.treatmentCvrTotal})`,
  );
  console.log(
    `  Success criterion (treat>=base):          ${v.successCriterionMet ? "PASS" : "FAIL"} ` +
      `(base=${v.baselineSuccessTotal}, treat=${v.treatmentSuccessTotal})`,
  );
  console.log("");
  console.log(`  Overall ETC reduction: ${(v.overallEtcReduction * 100).toFixed(1)}%`);
  console.log("");
  console.log(`  >>> SHIP: ${v.pass ? "YES" : "NO"}`);
  if (v.killSwitch.triggered) {
    console.log(`  >>> KILL SWITCH TRIGGERED:`);
    for (const r of v.killSwitch.reasons) console.log(`        - ${r}`);
  } else {
    console.log(`  >>> Kill switch: not triggered`);
  }
  console.log("");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
