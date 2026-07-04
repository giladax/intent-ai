/**
 * Live A/B collection runner (measurement-v2 §3.6–3.7 — the "unowned long
 * pole", now owned).
 *
 * Per (task × arm × run):
 *   1. fresh DETACHED git worktree at a pinned base commit
 *   2. decontaminated: the answer key (mvp-* criteria, scoring code, specs,
 *      audits, day reports) is removed from the working tree before the
 *      agent starts (fixes v1's F2 — answer-in-repo)
 *   3. headless `claude -p` with the task prompt injected at runtime;
 *      baseline gets an EMPTY strict MCP config (Brain unreachable),
 *      treatment gets the intent-brain server + brain_enter-first
 *      instruction — same model, same permission mode, same base commit
 *   4. artifacts captured to the run dir: transcript JSONL (from
 *      ~/.claude/projects/), final diff, tsc + targeted-test results
 *   5. a SessionInput row appended to the manifest — the existing
 *      `run-mvp-eval.ts --manifest` scoring path works unchanged
 *   6. an `eval:run` activity event lands on the journal (failure-safe)
 */

import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { TaskCriteria } from "./mvp-task-criteria.js";
import type { Arm, SessionInput } from "./mvp-eval.js";

const execFileAsync = promisify(execFile);

/** Model held constant across arms (v2 §3.1). */
export const PILOT_MODEL = "claude-sonnet-4-6";

/** Wall-clock cap per headless session. */
export const SESSION_TIMEOUT_MS = 25 * 60 * 1000;

// ── Decontamination (fixes F2 — answer-in-repo) ──────────────────────

/**
 * Paths removed from the eval worktree before the agent starts. Everything
 * that states a task, a constraint, or a harness mechanism. Directories are
 * removed recursively; missing paths are ignored.
 */
export const DECONTAMINATION_PATHS: string[] = [
  "src/eval/mvp-task-criteria.ts",
  "src/eval/mvp-eval.ts",
  "src/eval/mvp-judge.ts",
  "src/eval/cvr-checks.ts",
  "src/eval/live-runner.ts",
  "run-mvp-eval.ts",
  "tests/eval/mvp-eval.test.ts",
  "tests/eval/mvp-judge.test.ts",
  "tests/eval/mvp-decontamination.test.ts",
  "tests/eval/cvr-checks.test.ts",
  "docs/specs/2026-07-03-measurement-v2-spec.md",
  "docs/audits",
  "docs/handoffs",
  ".superpowers",
];

// ── Pure helpers (unit-tested without spawning anything) ─────────────

/**
 * Claude Code stores session transcripts under
 * `~/.claude/projects/<munged-realpath>/<session>.jsonl`, where the munge
 * replaces every non-alphanumeric character of the session cwd's REAL path
 * with "-" (verified empirically: /tmp → -private-tmp on macOS).
 */
export function mungeProjectPath(realCwd: string): string {
  return realCwd.replace(/[^a-zA-Z0-9]/g, "-");
}

export function transcriptDirFor(realCwd: string, home: string = os.homedir()): string {
  return path.join(home, ".claude", "projects", mungeProjectPath(realCwd));
}

/**
 * Build the task prompt. Both arms share the identical body; the treatment
 * arm gets ONLY the brain_enter-first instruction on top (the intervention
 * under test — v2 §3.1 holds everything else constant).
 */
export function buildTaskPrompt(task: TaskCriteria, arm: Arm): string {
  const body = [
    `Implement the following change in this repository:`,
    ``,
    task.goal,
    ``,
    `Requirements:`,
    `- Work only inside this repository checkout.`,
    `- When you are done, \`npx tsc --noEmit\` must pass and existing tests must not break.`,
    `- Do not commit; leave your changes in the working tree.`,
  ].join("\n");

  if (arm === "treatment") {
    return [
      `This repository has a Brain MCP server (intent-brain) that serves accumulated`,
      `feature knowledge. BEFORE exploring the codebase, call the`,
      `mcp__intent-brain__brain_enter tool with the task description or the file you`,
      `expect to edit, and use the returned feature context (understanding,`,
      `constraints, key moments) to guide your work.`,
      ``,
      body,
    ].join("\n");
  }
  return body;
}

/** MCP configuration per arm, passed via --strict-mcp-config (no ambient .mcp.json). */
export function mcpConfigFor(arm: Arm): string {
  if (arm === "baseline") return JSON.stringify({ mcpServers: {} });
  return JSON.stringify({
    mcpServers: {
      "intent-brain": {
        command: "npx",
        args: ["tsx", "src/cli/index.ts", "mcp"],
      },
    },
  });
}

/** Full argv for the headless session (everything but the cwd). */
export function claudeArgs(task: TaskCriteria, arm: Arm): string[] {
  return [
    "-p",
    buildTaskPrompt(task, arm),
    "--model",
    PILOT_MODEL,
    "--strict-mcp-config",
    "--mcp-config",
    mcpConfigFor(arm),
    // Unattended pilot runs in a throwaway detached worktree; edits and
    // commands are confined there. Recorded honestly in the pilot doc.
    "--dangerously-skip-permissions",
  ];
}

// ── Worktree lifecycle ───────────────────────────────────────────────

export interface RunContext {
  repoRoot: string;
  runDir: string;
  baseCommit: string;
  keepWorktrees: boolean;
}

async function sh(cwd: string, cmd: string, args: string[], timeoutMs = 120_000) {
  return execFileAsync(cmd, args, { cwd, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
}

export async function prepareWorktree(
  ctx: RunContext,
  label: string,
): Promise<string> {
  const dir = path.join(ctx.runDir, `wt-${label}`);
  await sh(ctx.repoRoot, "git", ["worktree", "add", "--detach", dir, ctx.baseCommit]);

  // Decontaminate (F2): the answer key never ships to the agent. The
  // removals are committed inside the worktree (detached, discarded with
  // it) so the captured diff contains ONLY the agent's changes.
  for (const p of DECONTAMINATION_PATHS) {
    fs.rmSync(path.join(dir, p), { recursive: true, force: true });
  }
  await sh(dir, "git", ["add", "-A"]);
  await sh(dir, "git", [
    "-c", "user.email=eval@intent-ai.local",
    "-c", "user.name=mvp-eval-runner",
    "commit", "-m", "decontaminate eval worktree (answer key removed)",
  ]);

  // Share deps + env: node_modules symlink; .env copied for the MCP server
  // child (DATABASE_URL) — identical in both arms for parity.
  const nm = path.join(ctx.repoRoot, "node_modules");
  if (fs.existsSync(nm)) fs.symlinkSync(nm, path.join(dir, "node_modules"));
  const env = path.join(ctx.repoRoot, ".env");
  if (fs.existsSync(env)) fs.copyFileSync(env, path.join(dir, ".env"));

  return dir;
}

export async function removeWorktree(ctx: RunContext, dir: string): Promise<void> {
  if (ctx.keepWorktrees) return;
  try {
    await sh(ctx.repoRoot, "git", ["worktree", "remove", "--force", dir]);
  } catch {
    // best-effort cleanup; `git worktree prune` recovers later
  }
}

// ── Artifact capture ─────────────────────────────────────────────────

function newestJsonl(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files.length ? path.join(dir, files[0].f) : null;
}

async function captureDiff(worktree: string): Promise<string> {
  // `add -N` makes untracked new files visible to diff without staging
  // content; `diff HEAD` also covers anything the agent staged.
  await sh(worktree, "git", ["add", "-N", "."]);
  const { stdout } = await sh(worktree, "git", ["diff", "HEAD"]);
  return stdout;
}

async function runCheck(worktree: string, cmd: string, timeoutMs: number): Promise<boolean> {
  const [bin, ...args] = cmd.split(" ");
  try {
    await sh(worktree, bin, args, timeoutMs);
    return true;
  } catch {
    return false;
  }
}

// ── One (task × arm × run) session ───────────────────────────────────

export interface LiveRunResult extends SessionInput {
  worktree: string;
  durationMs: number;
  claudeExitOk: boolean;
}

export async function runLiveSession(
  ctx: RunContext,
  task: TaskCriteria,
  arm: Arm,
  run: number,
): Promise<LiveRunResult> {
  const label = `${task.id}-${arm}-${run}`;
  const worktree = await prepareWorktree(ctx, label);
  const realWorktree = fs.realpathSync(worktree);

  fs.mkdirSync(ctx.runDir, { recursive: true });
  fs.writeFileSync(path.join(ctx.runDir, `prompt-${label}.txt`), buildTaskPrompt(task, arm));

  const startedAt = Date.now();
  let claudeExitOk = true;
  let stdout = "";
  let stderr = "";
  try {
    const res = await execFileAsync("claude", claudeArgs(task, arm), {
      cwd: worktree,
      timeout: SESSION_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env },
    });
    stdout = res.stdout;
    stderr = res.stderr;
  } catch (err) {
    claudeExitOk = false;
    const e = err as { stdout?: string; stderr?: string; message?: string };
    stdout = e.stdout ?? "";
    stderr = `${e.stderr ?? ""}\n${e.message ?? ""}`;
  }
  const durationMs = Date.now() - startedAt;
  fs.writeFileSync(path.join(ctx.runDir, `stdout-${label}.txt`), stdout);
  fs.writeFileSync(path.join(ctx.runDir, `stderr-${label}.txt`), stderr);

  // Transcript: newest JSONL in the worktree's munged project dir, copied
  // into the run dir so scoring survives worktree cleanup.
  const src = newestJsonl(transcriptDirFor(realWorktree));
  const transcriptPath = path.join(ctx.runDir, `transcript-${label}.jsonl`);
  if (src) fs.copyFileSync(src, transcriptPath);
  else fs.writeFileSync(transcriptPath, "");

  const diff = await captureDiff(worktree);
  fs.writeFileSync(path.join(ctx.runDir, `diff-${label}.patch`), diff);

  const tscPassed = await runCheck(worktree, "npx tsc --noEmit", 300_000);
  const testPassed = await runCheck(worktree, task.testCommand, 600_000);

  await removeWorktree(ctx, worktree);
  await emitEvalRunEvent(task, arm, run, { durationMs, tscPassed, testPassed, claudeExitOk });

  return {
    taskId: task.id,
    arm,
    run,
    transcriptPath,
    diff,
    tscPassed,
    testPassed,
    worktree,
    durationMs,
    claudeExitOk,
  };
}

/** v2 §3.7 item 5 — eval runs appear on the Brain timeline. Failure-safe. */
async function emitEvalRunEvent(
  task: TaskCriteria,
  arm: Arm,
  run: number,
  meta: Record<string, unknown>,
): Promise<void> {
  try {
    const { emitEvents } = await import("../storage/queries.js");
    await emitEvents([
      {
        timestamp: new Date(),
        category: "eval:run",
        tags: ["mvp", arm, task.id],
        actor: "system",
        summary: `MVP A/B live run: ${task.id} (${task.title}) ${arm} #${run}`,
        metadata: { taskId: task.id, arm, run, ...meta },
        sourceType: "eval",
        sourceId: `${task.id}-${arm}-${run}`,
      },
    ]);
  } catch {
    // the journal must never fail the measurement
  }
}

// ── Manifest ─────────────────────────────────────────────────────────

export function appendManifest(runDir: string, input: SessionInput): void {
  const manifestPath = path.join(runDir, "manifest.json");
  const existing: SessionInput[] = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, "utf-8"))
    : [];
  existing.push(input);
  fs.writeFileSync(manifestPath, JSON.stringify(existing, null, 2));
}
