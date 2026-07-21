import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { mvpTasks, tasksInStratum } from "../../src/eval/mvp-task-criteria.js";

/**
 * Baseline-decontamination guard (measurement-v2 §3.4, fixes v1's F1).
 *
 * v1's task-2/task-4 discriminating constraints were stated VERBATIM in
 * CLAUDE.md — which is injected into every baseline session's prompt — so
 * the baseline could never violate them and the CVR floor (baseline >= 2)
 * was structurally unreachable.
 *
 * This test greps everything the BASELINE arm receives (CLAUDE.md and the
 * frozen eval-baseline/brain.md) for each task's pre-registered contamination
 * terms.
 * If a doc edit ever states a discriminating rule, this suite fails and the
 * task must be redrawn BEFORE the next measurement run.
 */

const appRoot = join(__dirname, "..", ".."); // journal/
const repoRoot = join(appRoot, "..");

const BASELINE_DOCS = [
  { name: "CLAUDE.md", path: join(repoRoot, "CLAUDE.md") },
  { name: "eval-baseline/brain.md", path: join(appRoot, "eval-baseline", "brain.md") },
];

describe("baseline docs exist (the contamination surface is real)", () => {
  for (const doc of BASELINE_DOCS) {
    it(`${doc.name} exists`, () => {
      expect(existsSync(doc.path)).toBe(true);
    });
  }
});

describe("no task constraint is stated in what the baseline receives", () => {
  for (const doc of BASELINE_DOCS) {
    const text = existsSync(doc.path)
      ? readFileSync(doc.path, "utf-8").toLowerCase()
      : "";

    for (const task of mvpTasks) {
      it(`${task.id} (${task.title}) terms absent from ${doc.name}`, () => {
        for (const term of task.contaminationTerms) {
          expect(
            text.includes(term.toLowerCase()),
            `"${term}" (${task.id}) found in ${doc.name} — baseline is contaminated; redraw the task`,
          ).toBe(false);
        }
      });
    }
  }
});

describe("task-set shape (pre-registered)", () => {
  it("has exactly 5 tasks", () => {
    expect(mvpTasks).toHaveLength(5);
  });

  it("has 4 strong-stratum and 1 weak-stratum task", () => {
    expect(tasksInStratum("strong")).toHaveLength(4);
    expect(tasksInStratum("weak")).toHaveLength(1);
  });

  it("every strong task names a seeded Feature; the weak task names none", () => {
    for (const t of tasksInStratum("strong")) expect(t.feature).toBeTruthy();
    for (const t of tasksInStratum("weak")) expect(t.feature).toBeNull();
  });

  it("every task carries contamination terms and a hold-out note", () => {
    for (const t of mvpTasks) {
      expect(t.contaminationTerms.length).toBeGreaterThan(0);
      expect(t.holdoutNote.length).toBeGreaterThan(40);
      expect(t.testCommand.length).toBeGreaterThan(0);
    }
  });

  it("every task's correctFiles anchor exists in the current tree", () => {
    // The FIRST correctFiles entry of each task is a concrete path (not a
    // glob) by convention — assert it exists so tasks can't rot silently
    // (v1's task-5 pointed at src/brain/, which does not exist).
    for (const t of mvpTasks) {
      const anchor = t.correctFiles[0];
      expect(
        anchor.includes("*") || existsSync(join(appRoot, anchor)),
        `${t.id} anchor ${anchor} missing from tree`,
      ).toBe(true);
    }
  });
});
