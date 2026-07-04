import { describe, it, expect } from "vitest";
import {
  mungeProjectPath,
  transcriptDirFor,
  buildTaskPrompt,
  mcpConfigFor,
  claudeArgs,
  DECONTAMINATION_PATHS,
  PILOT_MODEL,
} from "../../src/eval/live-runner.js";
import { mvpTasks, getTask } from "../../src/eval/mvp-task-criteria.js";

describe("mungeProjectPath", () => {
  it("replaces every non-alphanumeric with '-' (empirical CC format)", () => {
    expect(mungeProjectPath("/private/tmp")).toBe("-private-tmp");
    expect(mungeProjectPath("/Users/x/dev/intent-ai")).toBe("-Users-x-dev-intent-ai");
    expect(mungeProjectPath("/Users/x/dev/brain/.worktrees/f")).toBe(
      "-Users-x-dev-brain--worktrees-f",
    );
  });

  it("transcriptDirFor roots under ~/.claude/projects", () => {
    const dir = transcriptDirFor("/private/tmp", "/home/u");
    expect(dir).toBe("/home/u/.claude/projects/-private-tmp");
  });
});

describe("buildTaskPrompt — the arms differ ONLY by the brain instruction", () => {
  const task = getTask("task-2")!;

  it("both arms share the identical task body", () => {
    const baseline = buildTaskPrompt(task, "baseline");
    const treatment = buildTaskPrompt(task, "treatment");
    expect(treatment.endsWith(baseline)).toBe(true);
  });

  it("treatment adds the brain_enter-first instruction; baseline never mentions the brain", () => {
    const baseline = buildTaskPrompt(task, "baseline");
    const treatment = buildTaskPrompt(task, "treatment");
    expect(treatment).toContain("mcp__intent-brain__brain_enter");
    expect(baseline.toLowerCase()).not.toContain("brain");
    expect(baseline.toLowerCase()).not.toContain("mcp");
  });

  it("the prompt carries the goal but NEVER the constraints (no answer-in-prompt)", () => {
    for (const t of mvpTasks) {
      for (const arm of ["baseline", "treatment"] as const) {
        const prompt = buildTaskPrompt(t, arm);
        expect(prompt).toContain(t.goal);
        for (const c of t.constraints) {
          expect(prompt).not.toContain(c.description);
          expect(prompt).not.toContain(c.violationLooksLike);
        }
      }
    }
  });
});

describe("mcpConfigFor / claudeArgs — arm parity", () => {
  it("baseline gets an empty strict MCP config (brain unreachable)", () => {
    expect(JSON.parse(mcpConfigFor("baseline"))).toEqual({ mcpServers: {} });
  });

  it("treatment gets exactly the intent-brain server", () => {
    const cfg = JSON.parse(mcpConfigFor("treatment"));
    expect(Object.keys(cfg.mcpServers)).toEqual(["intent-brain"]);
  });

  it("everything else is held constant across arms", () => {
    const task = getTask("task-2")!;
    const strip = (args: string[]) => {
      const out = [...args];
      // remove the two per-arm values: prompt (after -p) and mcp-config value
      out[out.indexOf("-p") + 1] = "<prompt>";
      out[out.indexOf("--mcp-config") + 1] = "<cfg>";
      return out;
    };
    expect(strip(claudeArgs(task, "baseline"))).toEqual(
      strip(claudeArgs(task, "treatment")),
    );
    expect(claudeArgs(task, "baseline")).toContain(PILOT_MODEL);
  });
});

describe("DECONTAMINATION_PATHS (fixes F2 — answer-in-repo)", () => {
  it("removes the task criteria, the scorer, the runner, and the spec", () => {
    for (const must of [
      "src/eval/mvp-task-criteria.ts",
      "src/eval/mvp-eval.ts",
      "src/eval/cvr-checks.ts",
      "src/eval/live-runner.ts",
      "run-mvp-eval.ts",
      "docs/specs/2026-07-03-measurement-v2-spec.md",
    ]) {
      expect(DECONTAMINATION_PATHS).toContain(must);
    }
  });

  it("removes audits and day reports (they narrate the task table)", () => {
    expect(DECONTAMINATION_PATHS).toContain("docs/audits");
    expect(DECONTAMINATION_PATHS).toContain(".superpowers");
  });
});
