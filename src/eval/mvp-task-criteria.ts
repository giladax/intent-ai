/**
 * MVP Measurement task criteria — the pre-registered task set for the
 * Brain feature-context A/B (Brain PRD v0.3, §Measurement harness).
 *
 * These 5 TaskCriteria are written BEFORE any run (EDD discipline). Each
 * encodes a real feature in this repo plus the ONE discriminating constraint
 * that feature-aware context is supposed to surface "at the right moment."
 *
 * Shape mirrors tests/eval/fidelity-criteria.ts: a typed, hand-authored
 * ground-truth object the scorer reads — never generated.
 *
 *   goal          — what the coding agent is asked to do
 *   correctFiles  — file path globs a correct edit must touch (drives ETC:
 *                   "first Edit/Write in a task-correct file")
 *   constraints   — pre-listed constraints; a violation in the final diff
 *                   counts toward CVR (the sharpest discriminator)
 *   acceptance    — how task success is judged (tsc + targeted test + judge)
 */

export interface TaskConstraint {
  /** stable id, e.g. "no-enum-on-category" */
  id: string;
  /** human-readable statement of the constraint */
  description: string;
  /** what a violation looks like in a diff — fed to the CVR judge */
  violationLooksLike: string;
}

export interface TaskCriteria {
  /** stable id, e.g. "task-1" */
  id: string;
  /** short title for tables */
  title: string;
  /** what the agent is asked to do */
  goal: string;
  /** globs (repo-relative) that a correct edit must touch */
  correctFiles: string[];
  /** pre-registered discriminating constraints (CVR source) */
  constraints: TaskConstraint[];
  /** how success is judged: deterministic checks + Haiku correctness judge */
  acceptance: string;
}

// ── Task 1: brain_recent MCP tool ────────────────────────────────────

export const task1BrainRecent: TaskCriteria = {
  id: "task-1",
  title: "MCP tool brain_recent",
  goal: "Add a new MCP tool `brain_recent` that returns the N latest activity events. It should be registered like the existing brain_* tools and reachable over the existing stdio transport.",
  correctFiles: ["src/mcp/server.ts", "src/mcp/**/*.ts"],
  constraints: [
    {
      id: "follow-tool-registration-pattern",
      description:
        "Register the tool using the same registration/handler pattern as the existing brain_* tools.",
      violationLooksLike:
        "A bespoke registration path, hand-rolled JSON-RPC handling, or a tool wired up differently from brain_overview/brain_search.",
    },
    {
      id: "no-new-transport",
      description:
        "Reuse the existing stdio transport; do not introduce HTTP/SSE/WebSocket or a second server.",
      violationLooksLike:
        "New transport imports (e.g. SSEServerTransport, express/http server), a new listen()/port, or a second MCP server instance.",
    },
  ],
  acceptance:
    "tsc --noEmit passes; brain_recent appears in the tool list and returns the N most recent activity_events ordered by timestamp desc; Haiku judge confirms it matches the brain_* tool shape.",
};

// ── Task 2: emit coding:struggle event ───────────────────────────────

export const task2StruggleEvent: TaskCriteria = {
  id: "task-2",
  title: "Emit coding:struggle event",
  goal: "Emit an activity event with category `coding:struggle` when a struggle moment is detected, carrying the usual denormalized session context.",
  correctFiles: ["src/pipeline/emit-events.ts", "src/pipeline/*.ts"],
  constraints: [
    {
      id: "category-freeform-no-enum",
      description:
        "activity_events.category is freeform TEXT — do NOT add an enum, CHECK constraint, or a migration to constrain it.",
      violationLooksLike:
        "A new Drizzle enum / pgEnum, a CHECK constraint on category, an ALTER TABLE migration touching category, or a TypeScript union narrowing the category column.",
    },
    {
      id: "emit-in-try-catch",
      description:
        "The emitEvents call must be wrapped in try/catch so it never fails the parent operation.",
      violationLooksLike:
        "An emitEvents/await emitEvents call with no surrounding try/catch, or one that rethrows/propagates.",
    },
  ],
  acceptance:
    "tsc --noEmit passes; a struggle moment produces an ActivityEvent with category exactly 'coding:struggle'; existing emit-events tests still pass; Haiku judge confirms denormalized context is carried.",
};

// ── Task 3: events --since <date> CLI filter ─────────────────────────

export const task3EventsSince: TaskCriteria = {
  id: "task-3",
  title: "events --since <date> filter",
  goal: "Add an `events --since <date>` CLI flag that filters the activity event stream to events on or after the given date.",
  correctFiles: ["src/cli/index.ts", "src/cli/*.ts", "src/storage/queries.ts"],
  constraints: [
    {
      id: "reuse-events-query-path",
      description:
        "Reuse the existing events query path; add a WHERE predicate, do not fork a new query function.",
      violationLooksLike:
        "A second/parallel events query implementation instead of extending the existing queryEvents path.",
    },
    {
      id: "denormalized-no-joins",
      description:
        "Filter on the denormalized columns on activity_events; introduce no JOINs.",
      violationLooksLike:
        "A SQL JOIN (innerJoin/leftJoin) or a sub-select against another table to resolve the date filter.",
    },
  ],
  acceptance:
    "tsc --noEmit passes; `events --since <date>` returns only events at/after the date; no new JOINs in the query; Haiku judge confirms the existing query path was reused.",
};

// ── Task 4: optional worktree on moment schema ───────────────────────

export const task4MomentWorktree: TaskCriteria = {
  id: "task-4",
  title: "optional worktree on moment",
  goal: "Add an optional `worktree` field (default null) to the moment schema so moments can carry the worktree they came from, without breaking existing parses.",
  correctFiles: [
    "src/adapters/types.ts",
    "src/llm/prompts/*.ts",
    "src/pipeline/understand/extract.ts",
  ],
  constraints: [
    {
      id: "zod-lenient-optional-default",
      description:
        "The new field must be lenient: `.optional().default(null)` (or equivalent), not a required field.",
      violationLooksLike:
        "A required Zod field (no .optional()/.default()), or a non-lenient addition that rejects payloads lacking worktree.",
    },
    {
      id: "dont-break-existing-parses",
      description:
        "Existing moment payloads (without worktree) must still parse.",
      violationLooksLike:
        "A schema change that makes prior fixtures/moments fail validation, or removal of .passthrough()/lenient handling.",
    },
  ],
  acceptance:
    "tsc --noEmit passes; moments without worktree still parse (default null); a moment with worktree round-trips; existing moment tests still pass.",
};

// ── Task 5: brain-export recency filter for topics ───────────────────

export const task5BrainExportRecency: TaskCriteria = {
  id: "task-5",
  title: "brain-export recency filter",
  goal: "Add a recency filter to brain-export so only recently-touched topics are written to the .repo/ markdown, keeping the DB and .repo/ stores in sync.",
  correctFiles: ["src/brain/*.ts", "src/cli/*.ts"],
  constraints: [
    {
      id: "two-store-sync",
      description:
        "Keep the two stores (Postgres + .repo/ markdown) consistent — the filter must apply to what is written, not silently diverge.",
      violationLooksLike:
        "Writing a filtered subset to .repo/ while leaving stale files behind, or mutating one store without the other.",
    },
    {
      id: "cite-moment-uuids",
      description:
        "Cite moment UUIDs, not array indices, when referencing evidence.",
      violationLooksLike:
        "Referencing moments by positional index (e.g. moments[0]) instead of their UUID in the exported markdown.",
    },
  ],
  acceptance:
    "tsc --noEmit passes; brain-export with the recency filter writes only recent topics and prunes stale .repo/ files; evidence cites moment UUIDs; Haiku judge confirms store consistency.",
};

export const mvpTasks: TaskCriteria[] = [
  task1BrainRecent,
  task2StruggleEvent,
  task3EventsSince,
  task4MomentWorktree,
  task5BrainExportRecency,
];

export function getTask(id: string): TaskCriteria | undefined {
  return mvpTasks.find((t) => t.id === id);
}
