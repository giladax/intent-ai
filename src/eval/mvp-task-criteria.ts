/**
 * MVP Measurement task criteria v2 — the pre-registered hold-out task set for
 * the Brain feature-context A/B (Brain PRD v0.3, §Measurement harness;
 * corrected per docs/specs/2026-07-03-measurement-v2-spec.md and the
 * 2026-07-04 strategic review's Day-3 prescription).
 *
 * v1 (June 28) was invalid: its discriminating constraints for tasks 2 & 4
 * were stated verbatim in CLAUDE.md (injected into every baseline session —
 * the baseline CVR floor was structurally unreachable), task 3 has since been
 * implemented (`events --since` shipped), and task 5 targeted `src/brain/`,
 * which does not exist. All five tasks are redrawn against the CURRENT tree
 * (2026-07-04, post corpus re-digest + Feature seeding).
 *
 * v2 selection rules (each task):
 *  - REAL: violating a constraint would genuinely be wrong in this repo.
 *  - DECONTAMINATED: the constraint is NOT stated in anything the baseline
 *    arm receives (CLAUDE.md, .repo/brain.md). `contaminationTerms` carries
 *    the grep terms; tests/eval/mvp-decontamination.test.ts enforces this
 *    against the live docs so drift re-fails the suite.
 *  - SERVED: the constraint IS present in the seeded Feature context the
 *    treatment arm gets via brain_enter/brain_feature_context (session-
 *    derived, provenance-gated — assembled, not authored; fixes v1's F5).
 *  - HOLD-OUT: the task's specific implementation is NOT narrated in any
 *    Feature's current_understanding (the treatment gets the rule, never the
 *    diff). `holdoutNote` records the check.
 *  - STRATIFIED: `treatmentStratum` records expected treatment coverage.
 *    Per the Day-2 review's binding condition, strata are analyzed
 *    separately — never averaged together. task-5 is deliberately weak
 *    (src/cli resolves to no Feature) and serves as the coverage-boundary
 *    control, not as a pass-bar task.
 *
 * Shape mirrors tests/eval/fidelity-criteria.ts: a typed, hand-authored
 * ground-truth object the scorer reads — never generated.
 */

export interface TaskConstraint {
  /** stable id, e.g. "occurred-time-not-digest-time" */
  id: string;
  /** human-readable statement of the constraint */
  description: string;
  /** what a violation looks like in a diff — fed to the CVR judge */
  violationLooksLike: string;
}

export type TreatmentStratum = "strong" | "weak";

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
  /** targeted test command the runner executes after the session */
  testCommand: string;
  /**
   * Expected treatment coverage: "strong" = correctFiles resolve to a seeded
   * Feature whose served constraints include the discriminating rule;
   * "weak" = no Feature resolves (candidate-list flow) — coverage control.
   */
  treatmentStratum: TreatmentStratum;
  /** the seeded Feature the task resolves to (null for the weak stratum) */
  feature: string | null;
  /**
   * Phrases that would indicate baseline contamination if they appeared in
   * CLAUDE.md / .repo/brain.md. Enforced by mvp-decontamination.test.ts.
   */
  contaminationTerms: string[];
  /** hold-out audit: why the task's answer is not in served understanding */
  holdoutNote: string;
}

// ── Task 1: brain_recent MCP tool (strong — MCP Server) ──────────────

export const task1BrainRecent: TaskCriteria = {
  id: "task-1",
  title: "MCP tool brain_recent",
  goal: "Add a new MCP tool `brain_recent` that returns the N latest activity events (default 20). Register it alongside the existing brain_* tools so it is reachable over the existing stdio transport.",
  correctFiles: ["src/mcp/server.ts", "src/mcp/**/*.ts"],
  constraints: [
    {
      id: "instrument-mcp-read",
      description:
        "Every Brain MCP read tool must emit an `mcp:<tool>` activity event (failure-safe self-instrumentation, like the existing brain_* reads do via emitRead/buildMcpReadEvent).",
      violationLooksLike:
        "A new brain_recent tool handler that returns results without emitting an mcp:* activity event — no emitRead / buildMcpReadEvent / emitMcpReadEvent call in the handler.",
    },
    {
      id: "no-new-transport",
      description:
        "Reuse the existing stdio transport and server instance; do not introduce HTTP/SSE/WebSocket or a second server.",
      violationLooksLike:
        "New transport imports (e.g. SSEServerTransport, express/http server), a new listen()/port, or a second MCP server instance.",
    },
  ],
  acceptance:
    "tsc --noEmit passes; brain_recent is registered like the sibling brain_* tools and returns the N most recent activity_events ordered by timestamp desc; the handler emits an mcp:recent activity event; Haiku judge confirms it matches the brain_* tool shape.",
  testCommand: "npx vitest run tests/mcp",
  treatmentStratum: "strong",
  feature: "MCP Server & Brain Query Layer",
  contaminationTerms: [
    "emitRead",
    "buildMcpReadEvent",
    "must emit an activity event",
    "self-instrumentation",
  ],
  holdoutNote:
    "The Feature's understanding narrates THAT instrumentation was added ('no MCP call was emitting activity events until instrumentation was added') and its constraints carry the rule ('Every MCP tool call must emit an activity event'); neither mentions brain_recent nor how to build a new tool. CLAUDE.md lists the 8 existing tools by name — brain_recent is not among them and no doc describes the registration recipe.",
};

// ── Task 2: discovery events at session time (strong — Event Backbone) ─

export const task2DiscoveryEvents: TaskCriteria = {
  id: "task-2",
  title: "Emit discovery events at session time",
  goal: "When a session digest emits its activity events, additionally emit one event per narrative discovery (category `discovery:narrative`), so discoveries are individually visible on the journal instead of only inside the session-summary event's metadata.",
  correctFiles: ["src/pipeline/emit-events.ts", "src/pipeline/orchestrator.ts"],
  constraints: [
    {
      id: "occurred-time-not-digest-time",
      description:
        "Event timestamps must reflect actual session time, not digest/emit time — use the session's ended-at timestamp (sessionTs), never a bare new Date() when session time is available.",
      violationLooksLike:
        "The new discovery events stamped with `timestamp: new Date()` (wall-clock at digest time) instead of the session timestamp already available in buildSessionEvents.",
    },
    {
      id: "source-backrefs",
      description:
        "New events must carry sourceType/sourceId back-references to the originating record (here: the narrative / session), like every other event built in emit-events.ts.",
      violationLooksLike:
        "Discovery events pushed without sourceType/sourceId fields.",
    },
  ],
  acceptance:
    "tsc --noEmit passes; a digest with N narrative discoveries yields N `discovery:narrative` events stamped at session time with source back-references; existing emit-events tests still pass.",
  testCommand: "npx vitest run tests/pipeline/emit-events.test.ts",
  treatmentStratum: "strong",
  feature: "Activity Event Backbone",
  contaminationTerms: [
    "actual session time, not digest time",
    "sourceType/sourceId",
    "source_type/source_id",
    "back-references",
  ],
  holdoutNote:
    "The Feature's constraints carry both rules ('Timestamps must reflect actual session time, not digest time'; 'source_type/source_id back-references must point to originating records'); its understanding never mentions discovery events or this change. CLAUDE.md's emit how-to lists category/tags/actor/summary/metadata and repo/branch/worktree auto-carry — it states neither rule (v1's task-2 constraints, which CLAUDE.md DID state, are retired).",
};

// ── Task 3: index on activity_events.category (strong — Storage) ─────

export const task3CategoryIndex: TaskCriteria = {
  id: "task-3",
  title: "Index activity_events.category",
  goal: "Category-prefix queries over activity_events scan the table; add a database index on the activity_events `category` column so they can use an index.",
  correctFiles: ["src/storage/schema.ts", "drizzle/**"],
  constraints: [
    {
      id: "schema-ts-source-of-truth",
      description:
        "schema.ts is the single source of truth: make the change in src/storage/schema.ts and add a NEW generated migration — never edit the existing baseline migration (drizzle/0000_*) or other applied migrations in place.",
      violationLooksLike:
        "A diff that modifies drizzle/0000_baseline.sql (or any already-applied migration) instead of adding a new migration generated from schema.ts.",
    },
    {
      id: "no-out-of-band-ddl",
      description:
        "No DDL outside the drizzle migration chain — do not execute CREATE INDEX/ALTER TABLE from application code or ad-hoc scripts.",
      violationLooksLike:
        "CREATE INDEX / ALTER TABLE statements added to application code (src/**) or a standalone script rather than a drizzle/ migration file.",
    },
  ],
  acceptance:
    "tsc --noEmit passes; schema.ts declares the index; a new drizzle migration (not an edit to an applied one) creates it; existing storage tests still pass.",
  testCommand: "npx vitest run tests/storage",
  treatmentStratum: "strong",
  feature: "Storage Schema & Migration Infrastructure",
  contaminationTerms: [
    "single clean baseline migration",
    "schema.ts as source of truth",
    "will not be reconstructed",
  ],
  holdoutNote:
    "The Feature's understanding narrates the migration-chain collapse and its constraints carry the rule ('Single clean baseline migration from schema.ts as source of truth'); nothing mentions a category index. CLAUDE.md says only where schema and migrations live ('Schema in src/storage/schema.ts, migrations in drizzle/') — it does not state how migrations must be produced nor that applied migrations are immutable. ('source of truth' appears in CLAUDE.md only about docs/prd.md as PRODUCT source of truth — asserted by the decontamination test as a scoped phrase: 'schema.ts as source of truth').",
};

// ── Task 4: harden extraction against missing evidence (strong — Digest) ─

export const task4EvidenceHardening: TaskCriteria = {
  id: "task-4",
  title: "Harden extraction against missing evidence",
  goal: "The understanding-stage extraction schema requires every claim to carry at least one evidence quote; model outputs that omit evidence currently fail the whole extraction call. Make the pipeline resilient: an extraction batch containing claims without valid evidence should not crash the digest.",
  correctFiles: [
    "src/llm/prompts/understand/extract.ts",
    "src/pipeline/understand/extract.ts",
    "src/pipeline/understand/*.ts",
  ],
  constraints: [
    {
      id: "no-evidence-defaults",
      description:
        "Never add .default()/fallback values to evidence fields — the evidence schema enforces .min(1) with no default, so a missing quote means the model didn't emit one, never a silently fabricated placeholder.",
      violationLooksLike:
        "Adding .optional().default(...) (or a hardcoded placeholder quote) to the evidence/quote fields of the extraction Zod schema.",
    },
    {
      id: "drop-dont-fabricate",
      description:
        "Claims without valid evidence must be dropped or rejected, not repaired with synthetic/fabricated evidence.",
      violationLooksLike:
        "Code that fills in evidence for a claim that lacked it (copying another claim's quote, inventing a quote, or substituting an empty-string quote) instead of discarding the claim.",
    },
  ],
  acceptance:
    "tsc --noEmit passes; an extraction payload with one evidence-less claim among valid ones digests without crashing, the evidence-less claim is dropped (not defaulted), and existing understand tests still pass.",
  testCommand: "npx vitest run tests/pipeline/understand",
  treatmentStratum: "strong",
  feature: "Digest Pipeline & Understanding Stage",
  contaminationTerms: [
    "no default, no fabrication",
    "min(1) with no default",
    "fallback value",
    "fabricated evidence",
  ],
  holdoutNote:
    "The Feature's constraints carry the rule ('Evidence schema enforces .min(1) with no default — null confidence means the model didn't emit it, not that it defaulted') and its understanding narrates the 101/102-fabricated-evidence audit; neither says how to make the batch resilient (the diff: catch/filter at parse boundary, drop claims). NOTE THE TRAP: CLAUDE.md's conventions actively push the OPPOSITE direction ('lenient schemas — .optional().default()'), so a docs-only baseline plausibly re-introduces the exact fabrication bug the audit removed. This is the sharpest discriminator in the set.",
};

// ── Task 5: events --json CLI flag (WEAK stratum — coverage control) ──

export const task5EventsJson: TaskCriteria = {
  id: "task-5",
  title: "events --json output flag",
  goal: "Add an `events --json` CLI flag that prints the queried activity events as JSON (one array, or one object per line) for scripting, instead of the human-readable table.",
  correctFiles: ["src/cli/index.ts", "src/cli/*.ts"],
  constraints: [
    {
      id: "reuse-events-query-path",
      description:
        "Reuse the existing queryEvents path in src/storage/queries.ts; the flag changes rendering only — do not fork a second query implementation.",
      violationLooksLike:
        "A second/parallel events query (new SQL against activity_events) instead of rendering the existing queryEvents result.",
    },
    {
      id: "cli-through-queries-layer",
      description:
        "The CLI never talks to Postgres directly — all DB access goes through src/storage/queries.ts (no postgres()/sql.unsafe/getClient in src/cli).",
      violationLooksLike:
        "Raw SQL, a postgres() client, or getClient() imported/created inside src/cli/**.",
    },
  ],
  acceptance:
    "tsc --noEmit passes; `events --json` emits machine-parseable JSON of the same events the table view shows; no new query path or raw SQL in src/cli.",
  testCommand: "npx vitest run tests/cli",
  treatmentStratum: "weak",
  feature: null,
  contaminationTerms: [
    "queryEvents path",
    "rendering only",
    "no raw SQL in src/cli",
  ],
  holdoutNote:
    "Coverage-boundary control (Day-2 review binding condition): src/cli/** resolves to NO seeded Feature, so brain_enter returns a candidate list and the treatment arm gets no discriminating context. Expected treatment effect ≈ 0; analyzed as its own stratum, never averaged with strong-stratum tasks. Constraints are still real and absent from baseline docs so the comparison is honest.",
};

export const mvpTasks: TaskCriteria[] = [
  task1BrainRecent,
  task2DiscoveryEvents,
  task3CategoryIndex,
  task4EvidenceHardening,
  task5EventsJson,
];

export function getTask(id: string): TaskCriteria | undefined {
  return mvpTasks.find((t) => t.id === id);
}

export function tasksInStratum(stratum: TreatmentStratum): TaskCriteria[] {
  return mvpTasks.filter((t) => t.treatmentStratum === stratum);
}
