import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import {
  mvpTasks,
  getTask,
  type TreatmentStratum,
} from "./src/eval/mvp-task-criteria.js";
import {
  scoreSession,
  aggregate,
  evaluatePassBar,
  evaluateStratifiedPassBar,
  type Arm,
  type SessionInput,
  type SessionScore,
  type TaskArmStats,
  type PassBarResult,
} from "./src/eval/mvp-eval.js";
import {
  runLiveSession,
  appendManifest,
  type RunContext,
} from "./src/eval/live-runner.js";

/**
 * MVP measurement A/B runner (Brain PRD v0.3, §Measurement harness;
 * measurement-v2 spec 2026-07-03; live collection added 2026-07-04).
 *
 * Modes:
 *   npx tsx run-mvp-eval.ts --manifest <sessions.json>
 *       score recorded runs (unchanged path)
 *
 *   npx tsx run-mvp-eval.ts --live --task task-2 [--runs 1] [--base HEAD]
 *                           [--arms baseline,treatment] [--out eval-runs/...]
 *                           [--keep-worktrees] [--no-score]
 *       COLLECT real sessions: per (task × arm × run) spin a decontaminated
 *       detached worktree at the base commit, run headless `claude -p`
 *       (baseline: empty strict MCP config; treatment: intent-brain MCP +
 *       brain_enter-first instruction), capture transcript/diff/tsc/test,
 *       append to the run manifest, then score it.
 *
 * Analysis is STRATIFIED (Day-2 review binding condition): pass bar + kill
 * switch evaluate the strong-treatment stratum only; the weak
 * coverage-control task is reported separately, never averaged in.
 */

const N_DEFAULT = 3;
const ARMS: Arm[] = ["baseline", "treatment"];

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

function loadManifest(p: string): SessionInput[] {
  const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
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

// ── Arg parsing (structural) ─────────────────────────────────────────

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

// ── Live collection ──────────────────────────────────────────────────

async function collectLive(args: string[]): Promise<SessionInput[]> {
  const taskId = argValue(args, "--task");
  if (!taskId) throw new Error("--live requires --task <task-id>");
  const task = getTask(taskId);
  if (!task) throw new Error(`Unknown task "${taskId}"`);

  const runs = Number(argValue(args, "--runs") ?? 1);
  const arms = (argValue(args, "--arms") ?? "baseline,treatment").split(",") as Arm[];
  const repoRoot = process.cwd();
  const baseCommit = execFileSync(
    "git",
    ["rev-parse", argValue(args, "--base") ?? "HEAD"],
    { cwd: repoRoot, encoding: "utf-8" },
  ).trim();
  const runDir = path.resolve(
    argValue(args, "--out") ??
      path.join("eval-runs", new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)),
  );
  fs.mkdirSync(runDir, { recursive: true });

  const ctx: RunContext = {
    repoRoot,
    runDir,
    baseCommit,
    keepWorktrees: args.includes("--keep-worktrees"),
  };

  console.log(`Live collection: ${task.id} (${task.title})`);
  console.log(`  stratum=${task.treatmentStratum} arms=${arms.join(",")} runs=${runs}`);
  console.log(`  base=${baseCommit.slice(0, 8)} out=${runDir}`);
  console.log("");

  const inputs: SessionInput[] = [];
  for (const arm of arms) {
    for (let run = 1; run <= runs; run++) {
      console.log(`  → running ${task.id}/${arm}#${run} (headless, this takes minutes)...`);
      const result = await runLiveSession(ctx, task, arm, run);
      console.log(
        `    done in ${(result.durationMs / 1000).toFixed(0)}s ` +
          `(claude=${result.claudeExitOk ? "ok" : "ERR"} tsc=${result.tscPassed} test=${result.testPassed})`,
      );
      const input: SessionInput = {
        taskId: result.taskId,
        arm: result.arm,
        run: result.run,
        transcriptPath: result.transcriptPath,
        diff: result.diff,
        tscPassed: result.tscPassed,
        testPassed: result.testPassed,
      };
      appendManifest(runDir, input);
      inputs.push(input);
    }
  }
  console.log(`\nManifest: ${path.join(runDir, "manifest.json")}`);
  return inputs;
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const manifestPath = argValue(args, "--manifest");

  console.log("=== MVP Measurement A/B (Brain PRD v0.3 / measurement-v2) ===");
  console.log(
    `Arms: ${ARMS.join(", ")} | Tasks: ${mvpTasks.length} ` +
      `(strong: ${mvpTasks.filter((t) => t.treatmentStratum === "strong").length}, ` +
      `weak: ${mvpTasks.filter((t) => t.treatmentStratum === "weak").length}) | default N=${N_DEFAULT}`,
  );
  console.log("");

  let inputs: SessionInput[];
  if (args.includes("--live")) {
    inputs = await collectLive(args);
    if (args.includes("--no-score")) return;
  } else if (manifestPath) {
    inputs = loadManifest(manifestPath);
    console.log(`Loaded ${inputs.length} recorded sessions from ${manifestPath}`);
  } else {
    console.log("Usage:");
    console.log("  npx tsx run-mvp-eval.ts --manifest <sessions.json>     score recorded runs");
    console.log("  npx tsx run-mvp-eval.ts --live --task <task-id> [...]  collect + score live runs");
    console.log("");
    console.log("Live options: --runs N --arms baseline,treatment --base <commit>");
    console.log("              --out <dir> --keep-worktrees --no-score");
    return;
  }

  console.log("\nScoring sessions (ETC/tokens deterministic; CVR structural-first + Haiku majority)...\n");
  const scores: SessionScore[] = [];
  for (const input of inputs) {
    const task = getTask(input.taskId)!;
    const score = await scoreSession(task, input);
    scores.push(score);
    const decided = (score.constraintOutcomes ?? [])
      .map((o) => `${o.constraintId}=${o.violated ? "VIOL" : "ok"}(${o.decidedBy})`)
      .join(" ");
    process.stderr.write(
      `  [${score.taskId}/${score.arm}#${score.run}] ETC=${score.etc} ` +
        `viol=${score.violations} tokens=${score.tokens?.total ?? "-"} ` +
        `success=${score.success}\n    ${decided}\n`,
    );
  }

  const stats = aggregate(scores);
  printComparisonTable(stats);

  const strata = new Map<string, TreatmentStratum>(
    mvpTasks.map((t) => [t.id, t.treatmentStratum]),
  );
  const presentTasks = new Set(stats.map((s) => s.taskId));
  const strataPresent = new Set(
    [...presentTasks].map((id) => strata.get(id) ?? "strong"),
  );

  if (strataPresent.size > 1 || strataPresent.has("strong")) {
    const sv = evaluateStratifiedPassBar(stats, strata);
    console.log("=== STRONG stratum (gates the pass bar) =============================");
    printVerdict(sv.strong);
    if (sv.tokenRatio != null) {
      console.log(
        `  Token ratio (treat/base, pooled medians): ${sv.tokenRatio.toFixed(2)} ` +
          `(bar <=1.15: ${sv.tokenCriterionMet ? "PASS" : "FAIL"}; kill >1.5: ${sv.tokenKillTriggered ? "TRIGGERED" : "no"})`,
      );
    }
    if (sv.weak) {
      console.log("=== WEAK stratum (coverage control — reported, never gated on) ======");
      for (const t of sv.weak.perTask) {
        const ratio = Number.isFinite(t.etcRatio) ? t.etcRatio.toFixed(2) : "inf";
        console.log(
          `  ${t.taskId}: ETC ${t.baselineEtcMedian}→${t.treatmentEtcMedian} (${ratio}x) ` +
            `CVR ${t.baselineCvr}→${t.treatmentCvr}`,
        );
      }
      console.log("");
    }
  } else {
    // weak-only run: report without a pass-bar claim
    const verdict = evaluatePassBar(stats);
    console.log("(weak-stratum-only run — informational, no pass-bar claim)");
    printVerdict(verdict);
  }
}

// ── Output ───────────────────────────────────────────────────────────

function printComparisonTable(stats: TaskArmStats[]) {
  const byKey = new Map(stats.map((s) => [`${s.taskId}::${s.arm}`, s]));
  const taskIds = [...new Set(stats.map((s) => s.taskId))].sort();

  console.log("");
  console.log("=== A/B Results ======================================================");
  console.log("");
  console.log(
    "Task     | strat  | base ETC (min/med/max) | treat ETC (min/med/max) | base CVR | treat CVR | base ok | treat ok",
  );
  console.log(
    "---------+--------+------------------------+-------------------------+----------+-----------+---------+---------",
  );

  const fmtEtc = (s?: TaskArmStats) =>
    s ? `${s.etcMin}/${s.etcMedian}/${s.etcMax}` : "-/-/-";

  for (const taskId of taskIds) {
    const base = byKey.get(`${taskId}::baseline`);
    const treat = byKey.get(`${taskId}::treatment`);
    const stratum = getTask(taskId)?.treatmentStratum ?? "?";
    console.log(
      `${taskId.padEnd(8)} | ${stratum.padEnd(6)} | ${fmtEtc(base).padEnd(22)} | ${fmtEtc(treat).padEnd(23)} | ` +
        `${String(base?.cvrTotal ?? 0).padEnd(8)} | ${String(treat?.cvrTotal ?? 0).padEnd(9)} | ` +
        `${String(base?.successCount ?? 0).padEnd(7)} | ${String(treat?.successCount ?? 0)}`,
    );
  }
  console.log("");
}

function printVerdict(v: PassBarResult) {
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
    `  ETC criterion (>=3 tasks <=0.7x):         ${v.etcCriterionMet ? "PASS" : "FAIL"} ` +
      `(${v.etcImprovedTasks.length}: ${v.etcImprovedTasks.join(", ") || "none"})`,
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
