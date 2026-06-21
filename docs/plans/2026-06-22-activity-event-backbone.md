# Activity Event Backbone Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a unified `activity_events` table that captures every significant thing that happens in the system — session moments, brain mutations, live observations — as time-ordered, searchable, RAG-ready events.

**Architecture:** The event table is an index layer over existing tables. Events are self-contained (denormalized session context, no joins needed). Categories and tags are freeform text — no enums. Embeddings populated async for RAG. Existing pipeline, storage, and brain tables are unchanged.

**Tech Stack:** Drizzle ORM (schema), postgres (raw SQL), pgvector (embeddings), vitest (tests), Zod (validation)

**Spec:** `docs/superpowers/specs/2026-06-21-activity-event-backbone-design.md`

---

### Task 1: Install pgvector and add schema

**Files:**
- Modify: `src/storage/schema.ts`
- Modify: `package.json`

**Step 1: Install pgvector drizzle support**

Run: `npm install drizzle-orm/pg-core` (already have it — just need the vector column type)

Check if `drizzle-orm` supports `vector` natively. If not, we define the column as `text` for now and cast in queries. pgvector extension must be enabled in Postgres.

**Step 2: Add the activity_events table to schema.ts**

Add at the end of `src/storage/schema.ts`:

```typescript
export const activityEvents = pgTable("activity_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  category: text("category").notNull(),
  tags: text("tags").array().default([]),
  actor: text("actor").notNull(),
  summary: text("summary").notNull(),
  metadata: jsonb("metadata").default({}),

  // Source pointer
  sourceType: text("source_type"),
  sourceId: uuid("source_id"),

  // Session context (denormalized)
  sessionId: uuid("session_id"),
  repo: text("repo"),
  branch: text("branch"),
  worktree: text("worktree"),

  // Searchable dimensions
  topicIds: uuid("topic_ids").array().default([]),
  files: text("files").array().default([]),

  // RAG — stored as text, cast to vector in queries
  // (pgvector extension must be enabled separately)
  embedding: text("embedding"),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
```

**Step 3: Generate migration**

Run: `npx drizzle-kit generate`

**Step 4: Add pgvector extension + indexes to migration**

Edit the generated migration SQL to prepend:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Then after the CREATE TABLE, add:

```sql
ALTER TABLE activity_events ALTER COLUMN embedding TYPE vector(1536) USING embedding::vector(1536);

CREATE INDEX idx_activity_events_category ON activity_events USING btree (category text_pattern_ops);
CREATE INDEX idx_activity_events_timestamp ON activity_events USING btree (timestamp);
CREATE INDEX idx_activity_events_session_id ON activity_events USING btree (session_id);
CREATE INDEX idx_activity_events_repo ON activity_events USING btree (repo);
CREATE INDEX idx_activity_events_branch ON activity_events USING btree (branch);
CREATE INDEX idx_activity_events_tags ON activity_events USING gin (tags);
CREATE INDEX idx_activity_events_topic_ids ON activity_events USING gin (topic_ids);
CREATE INDEX idx_activity_events_files ON activity_events USING gin (files);
CREATE INDEX idx_activity_events_category_timestamp ON activity_events USING btree (category, timestamp);
CREATE INDEX idx_activity_events_repo_branch ON activity_events USING btree (repo, branch);
```

HNSW index for embedding deferred until embeddings are populated.

**Step 5: Run migration**

Run: `npx tsx src/cli/index.ts up`
Expected: Migration runs, table created, pgvector extension enabled.

**Step 6: Verify**

Run: `psql -p 5433 -U postgres -d intent -c "\d activity_events"`
Expected: Table with all columns, correct types.

**Step 7: Commit**

```bash
git add src/storage/schema.ts drizzle/
git commit -m "feat: add activity_events table with pgvector support"
```

---

### Task 2: Add ActivityEvent type

**Files:**
- Modify: `src/adapters/types.ts`

**Step 1: Add the type**

Add at the end of `src/adapters/types.ts`:

```typescript
export interface ActivityEvent {
  id?: string;
  timestamp: Date;
  category: string;
  tags: string[];
  actor: string;
  summary: string;
  metadata: Record<string, unknown>;
  sourceType?: string;
  sourceId?: string;
  sessionId?: string;
  repo?: string;
  branch?: string;
  worktree?: string;
  topicIds?: string[];
  files?: string[];
  embedding?: number[];
}
```

**Step 2: Commit**

```bash
git add src/adapters/types.ts
git commit -m "feat: add ActivityEvent type"
```

---

### Task 3: Write event storage functions

**Files:**
- Modify: `src/storage/queries.ts`
- Create: `tests/storage/events.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ActivityEvent } from "../../src/adapters/types.js";

// We'll test the emit and query functions
// Mock the database client
vi.mock("../../src/storage/connection.js", () => ({
  getClient: vi.fn(),
}));

import { emitEvent, emitEvents, queryEvents } from "../../src/storage/queries.js";
import { getClient } from "../../src/storage/connection.js";

const mockSql = vi.fn();
(vi.mocked(getClient) as any).mockReturnValue(mockSql);

describe("emitEvent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserts a single event", async () => {
    mockSql.mockResolvedValue([{ id: "test-id" }]);

    const event: ActivityEvent = {
      timestamp: new Date("2026-06-22T10:00:00Z"),
      category: "coding:discovery",
      tags: ["auth"],
      actor: "ai",
      summary: "Found the auth middleware in src/auth.ts",
      metadata: { confidence: "high" },
      sessionId: "session-1",
      repo: "intent-ai",
      branch: "feat/auth",
      files: ["src/auth.ts"],
    };

    const id = await emitEvent(event);
    expect(id).toBe("test-id");
    expect(mockSql).toHaveBeenCalledOnce();
  });
});

describe("queryEvents", () => {
  beforeEach(() => vi.clearAllMocks());

  it("queries with category prefix filter", async () => {
    mockSql.mockResolvedValue([]);

    await queryEvents({ categoryPrefix: "coding:" });
    expect(mockSql).toHaveBeenCalledOnce();
  });

  it("queries with multiple filters", async () => {
    mockSql.mockResolvedValue([]);

    await queryEvents({
      categoryPrefix: "coding:",
      repo: "intent-ai",
      branch: "feat/auth",
      since: new Date("2026-06-01"),
      limit: 10,
    });
    expect(mockSql).toHaveBeenCalledOnce();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/storage/events.test.ts`
Expected: FAIL — `emitEvent`, `emitEvents`, `queryEvents` not exported from queries.

**Step 3: Implement the storage functions**

Add to `src/storage/queries.ts`:

```typescript
import type { ActivityEvent } from "../adapters/types.js";

export async function emitEvent(event: ActivityEvent): Promise<string> {
  const client = getClient();
  const id = event.id ?? randomUUID();
  await client`
    INSERT INTO activity_events (
      id, timestamp, category, tags, actor, summary, metadata,
      source_type, source_id, session_id, repo, branch, worktree,
      topic_ids, files
    ) VALUES (
      ${id},
      ${event.timestamp.toISOString()},
      ${event.category},
      ${event.tags ?? []},
      ${event.actor},
      ${event.summary},
      ${JSON.stringify(event.metadata ?? {})},
      ${event.sourceType ?? null},
      ${event.sourceId ?? null},
      ${event.sessionId ?? null},
      ${event.repo ?? null},
      ${event.branch ?? null},
      ${event.worktree ?? null},
      ${event.topicIds ?? []},
      ${event.files ?? []}
    )
  `;
  return id;
}

export async function emitEvents(events: ActivityEvent[]): Promise<string[]> {
  const ids: string[] = [];
  for (const event of events) {
    ids.push(await emitEvent(event));
  }
  return ids;
}

export interface EventQuery {
  categoryPrefix?: string;
  tags?: string[];
  actor?: string;
  sessionId?: string;
  repo?: string;
  branch?: string;
  files?: string[];
  topicIds?: string[];
  since?: Date;
  until?: Date;
  limit?: number;
  offset?: number;
}

export async function queryEvents(query: EventQuery): Promise<ActivityEvent[]> {
  const client = getClient();
  const conditions: string[] = ["TRUE"];

  if (query.categoryPrefix) conditions.push(`category LIKE '${query.categoryPrefix}%'`);
  if (query.actor) conditions.push(`actor = '${query.actor}'`);
  if (query.sessionId) conditions.push(`session_id = '${query.sessionId}'`);
  if (query.repo) conditions.push(`repo = '${query.repo}'`);
  if (query.branch) conditions.push(`branch = '${query.branch}'`);
  if (query.since) conditions.push(`timestamp >= '${query.since.toISOString()}'`);
  if (query.until) conditions.push(`timestamp <= '${query.until.toISOString()}'`);
  if (query.tags?.length) conditions.push(`tags && ARRAY[${query.tags.map(t => `'${t}'`).join(",")}]::text[]`);
  if (query.files?.length) conditions.push(`files && ARRAY[${query.files.map(f => `'${f}'`).join(",")}]::text[]`);
  if (query.topicIds?.length) conditions.push(`topic_ids && ARRAY[${query.topicIds.map(id => `'${id}'`).join(",")}]::uuid[]`);

  const limit = query.limit ?? 100;
  const offset = query.offset ?? 0;
  const where = conditions.join(" AND ");

  const rows = await client.unsafe(
    `SELECT * FROM activity_events WHERE ${where} ORDER BY timestamp DESC LIMIT ${limit} OFFSET ${offset}`
  );

  return rows.map(rowToActivityEvent);
}

function rowToActivityEvent(row: any): ActivityEvent {
  return {
    id: row.id,
    timestamp: new Date(row.timestamp),
    category: row.category,
    tags: row.tags ?? [],
    actor: row.actor,
    summary: row.summary,
    metadata: row.metadata ?? {},
    sourceType: row.source_type,
    sourceId: row.source_id,
    sessionId: row.session_id,
    repo: row.repo,
    branch: row.branch,
    worktree: row.worktree,
    topicIds: row.topic_ids ?? [],
    files: row.files ?? [],
  };
}
```

> **Note:** The `queryEvents` function uses `unsafe` for dynamic WHERE clauses. Input values come from application code (not user input), but a future task should parameterize this properly if the query API is exposed externally.

**Step 4: Run tests**

Run: `npx vitest run tests/storage/events.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/storage/queries.ts tests/storage/events.test.ts
git commit -m "feat: add emitEvent, emitEvents, queryEvents storage functions"
```

---

### Task 4: Build the session event emitter

**Files:**
- Create: `src/pipeline/emit-events.ts`
- Create: `tests/pipeline/emit-events.test.ts`

This is the function that takes a digested session (moments, transitions, outcomes, narrative) and produces ActivityEvent objects.

**Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import type {
  SessionMoment,
  IntentTransition,
  AcceptedOutcome,
  SessionNarrative,
  ActivityEvent,
} from "../../src/adapters/types.js";

import { buildSessionEvents } from "../../src/pipeline/emit-events.js";

const sessionContext = {
  sessionId: "s1",
  repo: "intent-ai",
  branch: "feat/auth",
  worktree: undefined,
};

describe("buildSessionEvents", () => {
  it("emits a session summary event", () => {
    const narrative: SessionNarrative = {
      sessionId: "s1",
      sessionShape: "narrative",
      summary: "Implemented auth middleware with JWT validation",
      progression: ["started with research", "built middleware"],
      discoveries: ["found existing helper"],
      stabilizedDirections: ["JWT approach"],
      abandonedDirections: [],
      arcs: [],
    };

    const events = buildSessionEvents({
      ...sessionContext,
      moments: [],
      transitions: [],
      outcomes: [],
      narrative,
    });

    const summaryEvents = events.filter((e) => e.sourceType === "narrative");
    expect(summaryEvents).toHaveLength(1);
    expect(summaryEvents[0].summary).toContain("auth middleware");
    expect(summaryEvents[0].sessionId).toBe("s1");
    expect(summaryEvents[0].repo).toBe("intent-ai");
    expect(summaryEvents[0].branch).toBe("feat/auth");
  });

  it("emits one event per moment", () => {
    const moments: SessionMoment[] = [
      {
        id: "m1",
        chunkId: "c1",
        type: "struggle",
        statement: "Agent struggled with circular imports in auth module",
        significance: "high",
        agency: "ai",
        confidence: "high",
        topicFingerprint: "auth",
        evidence: [],
      },
      {
        id: "m2",
        chunkId: "c1",
        type: "discovery",
        statement: "Found existing JWT helper in utils",
        significance: "medium",
        agency: "collaborative",
        confidence: "medium",
        topicFingerprint: "auth",
        evidence: [],
      },
    ];

    const narrative: SessionNarrative = {
      sessionId: "s1",
      sessionShape: "narrative",
      summary: "Auth work",
      progression: [],
      discoveries: [],
      stabilizedDirections: [],
      abandonedDirections: [],
      arcs: [],
    };

    const events = buildSessionEvents({
      ...sessionContext,
      moments,
      transitions: [],
      outcomes: [],
      narrative,
    });

    const momentEvents = events.filter((e) => e.sourceType === "moment");
    expect(momentEvents).toHaveLength(2);
    expect(momentEvents[0].summary).toContain("circular imports");
    expect(momentEvents[0].sourceId).toBe("m1");
    expect(momentEvents[0].actor).toBe("ai");
  });

  it("emits one event per transition", () => {
    const transitions: IntentTransition[] = [
      {
        id: "t1",
        sessionId: "s1",
        fromStatement: "Research auth approaches",
        toStatement: "Implement JWT middleware",
        reason: "Found JWT library",
        originMomentIds: ["m1"],
        confidence: "high",
      },
    ];

    const narrative: SessionNarrative = {
      sessionId: "s1",
      sessionShape: "narrative",
      summary: "Auth work",
      progression: [],
      discoveries: [],
      stabilizedDirections: [],
      abandonedDirections: [],
      arcs: [],
    };

    const events = buildSessionEvents({
      ...sessionContext,
      moments: [],
      transitions,
      outcomes: [],
      narrative,
    });

    const transitionEvents = events.filter((e) => e.sourceType === "transition");
    expect(transitionEvents).toHaveLength(1);
    expect(transitionEvents[0].summary).toContain("Research auth approaches");
    expect(transitionEvents[0].summary).toContain("Implement JWT middleware");
  });

  it("emits one event per outcome", () => {
    const outcomes: AcceptedOutcome[] = [
      {
        id: "o1",
        sessionId: "s1",
        statement: "JWT middleware implemented and tested",
        supportingMomentIds: ["m1"],
        supportingFiles: ["src/auth/jwt.ts"],
        confidence: "high",
      },
    ];

    const narrative: SessionNarrative = {
      sessionId: "s1",
      sessionShape: "narrative",
      summary: "Auth work",
      progression: [],
      discoveries: [],
      stabilizedDirections: [],
      abandonedDirections: [],
      arcs: [],
    };

    const events = buildSessionEvents({
      ...sessionContext,
      moments: [],
      transitions: [],
      outcomes,
      narrative,
    });

    const outcomeEvents = events.filter((e) => e.sourceType === "outcome");
    expect(outcomeEvents).toHaveLength(1);
    expect(outcomeEvents[0].files).toContain("src/auth/jwt.ts");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pipeline/emit-events.test.ts`
Expected: FAIL — `buildSessionEvents` not found.

**Step 3: Implement emit-events.ts**

```typescript
import type {
  SessionMoment,
  IntentTransition,
  AcceptedOutcome,
  SessionNarrative,
  ActivityEvent,
} from "../adapters/types.js";

export interface SessionEventInput {
  sessionId: string;
  repo?: string;
  branch?: string;
  worktree?: string;
  moments: SessionMoment[];
  transitions: IntentTransition[];
  outcomes: AcceptedOutcome[];
  narrative: SessionNarrative;
}

export function buildSessionEvents(input: SessionEventInput): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  const ctx = {
    sessionId: input.sessionId,
    repo: input.repo,
    branch: input.branch,
    worktree: input.worktree,
  };

  // Session summary event
  events.push({
    timestamp: new Date(),
    category: input.narrative.sessionShape,
    tags: [],
    actor: "system",
    summary: input.narrative.summary,
    metadata: {
      progression: input.narrative.progression,
      discoveries: input.narrative.discoveries,
      stabilizedDirections: input.narrative.stabilizedDirections,
      abandonedDirections: input.narrative.abandonedDirections,
      arcCount: input.narrative.arcs.length,
    },
    sourceType: "narrative",
    sourceId: input.sessionId,
    ...ctx,
  });

  // Moment events
  for (const moment of input.moments) {
    const filesFromEvidence = moment.evidence
      ?.flatMap((e) => [])  // moments don't carry files directly
      ?? [];

    events.push({
      timestamp: new Date(),
      category: moment.type,
      tags: [moment.topicFingerprint, moment.significance, moment.confidence].filter(Boolean) as string[],
      actor: moment.agency,
      summary: moment.statement,
      metadata: {
        significance: moment.significance,
        confidence: moment.confidence,
        arcId: moment.arcId,
        arcRole: moment.arcRole,
        chunkId: moment.chunkId,
      },
      sourceType: "moment",
      sourceId: moment.id,
      ...ctx,
    });
  }

  // Transition events
  for (const transition of input.transitions) {
    events.push({
      timestamp: new Date(),
      category: "transition",
      tags: [],
      actor: "collaborative",
      summary: `${transition.fromStatement} → ${transition.toStatement}: ${transition.reason}`,
      metadata: {
        from: transition.fromStatement,
        to: transition.toStatement,
        reason: transition.reason,
        confidence: transition.confidence,
        originMomentIds: transition.originMomentIds,
      },
      sourceType: "transition",
      sourceId: transition.id,
      ...ctx,
    });
  }

  // Outcome events
  for (const outcome of input.outcomes) {
    events.push({
      timestamp: new Date(),
      category: "outcome",
      tags: [],
      actor: "collaborative",
      summary: outcome.statement,
      metadata: {
        confidence: outcome.confidence,
        supportingMomentIds: outcome.supportingMomentIds,
      },
      sourceType: "outcome",
      sourceId: outcome.id,
      files: outcome.supportingFiles,
      ...ctx,
    });
  }

  return events;
}
```

**Step 4: Run tests**

Run: `npx vitest run tests/pipeline/emit-events.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline/emit-events.ts tests/pipeline/emit-events.test.ts
git commit -m "feat: add buildSessionEvents to produce activity events from session digest"
```

---

### Task 5: Wire emit step into the pipeline orchestrator

**Files:**
- Modify: `src/pipeline/orchestrator.ts`

**Step 1: Add git context resolution**

Create a small helper to get repo/branch/worktree from the session source path:

```typescript
import { execSync } from "child_process";

function getGitContext(sourcePath: string): { repo?: string; branch?: string; worktree?: string } {
  try {
    const dir = path.dirname(sourcePath);
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: dir, encoding: "utf-8" }).trim();
    const toplevel = execSync("git rev-parse --show-toplevel", { cwd: dir, encoding: "utf-8" }).trim();
    const repo = path.basename(toplevel);
    // Detect worktree: if toplevel differs from main worktree
    let worktree: string | undefined;
    try {
      const mainWorktree = execSync("git rev-parse --path-format=absolute --git-common-dir", { cwd: dir, encoding: "utf-8" }).trim().replace(/\/.git$/, "");
      if (mainWorktree !== toplevel) worktree = toplevel;
    } catch { /* not a worktree */ }
    return { repo, branch, worktree };
  } catch {
    return {};
  }
}
```

**Step 2: Import and wire after store step**

After the `storeSessionDigest` call in `runPipeline`, add:

```typescript
const { buildSessionEvents } = await import("./emit-events.js");
const { emitEvents } = await import("../storage/queries.js");

const gitCtx = getGitContext(logPath);
const activityEvents = buildSessionEvents({
  sessionId,
  repo: gitCtx.repo,
  branch: gitCtx.branch,
  worktree: gitCtx.worktree,
  moments: sessionMoments,
  transitions,
  outcomes,
  narrative,
});

try {
  await emitEvents(activityEvents);
  process.stderr.write(`  → Emitted ${activityEvents.length} activity events\n`);
} catch (err) {
  process.stderr.write(`  ⚠ Failed to emit activity events: ${err}\n`);
}
```

**Step 3: Run existing pipeline tests to verify no regression**

Run: `npx vitest run tests/pipeline/orchestrator.test.ts`
Expected: PASS (emit step errors are caught, don't break pipeline)

**Step 4: Commit**

```bash
git add src/pipeline/orchestrator.ts
git commit -m "feat: wire activity event emission into digest pipeline"
```

---

### Task 6: Build brain event emitter

**Files:**
- Modify: `src/pipeline/brain-apply.ts`
- Create: `tests/pipeline/brain-emit-events.test.ts`

**Step 1: Write the failing test**

Test that `brain-apply` emits events when topics/insights/skills are created or updated. The test should verify that after applying a graph plan, the right activity events are produced.

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/storage/queries.js", () => ({
  emitEvents: vi.fn().mockResolvedValue([]),
  // ... other mocked functions brain-apply needs
}));

import { emitEvents } from "../../src/storage/queries.js";

const mockedEmitEvents = vi.mocked(emitEvents);

describe("brain-apply event emission", () => {
  beforeEach(() => vi.clearAllMocks());

  it("emits events for created topics", async () => {
    // Run a brain-apply with a create action
    // Verify emitEvents was called with topic creation events
    // Check event has category, summary, sourceType="topic"
  });

  it("emits events for new insights", async () => {
    // Verify insight creation events
  });
});
```

> **Note:** The exact test shape depends on `brain-apply.ts` internals. Read the file first, then write tests that hook into the existing apply flow.

**Step 2: Add event emission calls into brain-apply.ts**

After each create/update/merge operation, call `emitEvents` with the appropriate activity events. Follow the same non-blocking pattern as the pipeline (catch errors, log, don't fail).

**Step 3: Run tests**

Run: `npx vitest run tests/pipeline/brain-emit-events.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/pipeline/brain-apply.ts tests/pipeline/brain-emit-events.test.ts
git commit -m "feat: emit activity events from brain-apply for topic/insight/skill mutations"
```

---

### Task 7: Add `intent events` CLI command

**Files:**
- Modify: `src/cli/index.ts`

**Step 1: Add the command**

```typescript
program
  .command("events")
  .description("Query the activity event stream")
  .option("--category <prefix>", "Filter by category prefix")
  .option("--repo <repo>", "Filter by repo")
  .option("--branch <branch>", "Filter by branch")
  .option("--session <id>", "Filter by session ID")
  .option("--since <date>", "Events after this date")
  .option("--limit <n>", "Max events", "20")
  .action(async (opts) => {
    const { queryEvents } = await import("../storage/queries.js");
    const events = await queryEvents({
      categoryPrefix: opts.category,
      repo: opts.repo,
      branch: opts.branch,
      sessionId: opts.session,
      since: opts.since ? new Date(opts.since) : undefined,
      limit: parseInt(opts.limit),
    });

    for (const event of events) {
      const time = event.timestamp.toISOString().slice(0, 16);
      const tags = event.tags.length ? ` [${event.tags.join(", ")}]` : "";
      process.stdout.write(`${time} | ${event.category} | ${event.actor} | ${event.summary}${tags}\n`);
    }

    if (events.length === 0) {
      process.stdout.write("No events found.\n");
    }

    const { closeDb } = await import("../storage/connection.js");
    await closeDb();
  });
```

**Step 2: Test manually**

Run: `npx tsx src/cli/index.ts events --limit 5`
Expected: Shows recent events (or "No events found" if none emitted yet).

**Step 3: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat: add intent events CLI command for querying activity stream"
```

---

### Task 8: EDD — Define eval criteria for event emission quality

**Files:**
- Create: `tests/eval/event-emission-criteria.ts`
- Create: `tests/eval/event-emission.test.ts`

**Step 1: Define criteria**

```typescript
export interface EventEmissionCriteria {
  name: string;
  fixture: string;
  expectations: {
    minEvents: number;
    mustHaveSummaryEvent: boolean;
    momentCountRange: [number, number];
    noVagueSummaries: boolean; // no summaries shorter than 20 chars
    allEventsHaveSessionId: boolean;
    allEventsHaveRepo: boolean;
  };
}

export const eventEmissionCriteria: EventEmissionCriteria[] = [
  {
    name: "sample-session",
    fixture: "tests/fixtures/sample-session.jsonl",
    expectations: {
      minEvents: 3, // at least summary + some moments
      mustHaveSummaryEvent: true,
      momentCountRange: [2, 20],
      noVagueSummaries: true,
      allEventsHaveSessionId: true,
      allEventsHaveRepo: false, // fixture may not have git context
    },
  },
];
```

**Step 2: Write eval test**

```typescript
import { describe, it, expect } from "vitest";
import { eventEmissionCriteria } from "./event-emission-criteria.js";
import { runPipeline } from "../../src/pipeline/orchestrator.js";
import { buildSessionEvents } from "../../src/pipeline/emit-events.js";

describe("event emission quality", () => {
  for (const criteria of eventEmissionCriteria) {
    describe(criteria.name, () => {
      // Run pipeline on fixture, then buildSessionEvents, then check criteria
      // This is an integration test — may need to mock LLM calls
    });
  }
});
```

> **Note:** Full integration requires LLM calls. For unit-level eval, use pre-computed pipeline outputs as fixtures (moments, transitions, outcomes from a known session). Save a snapshot of pipeline output for a known session and test against that.

**Step 3: Commit**

```bash
git add tests/eval/event-emission-criteria.ts tests/eval/event-emission.test.ts
git commit -m "feat: add EDD criteria for event emission quality"
```

---

### Task 9: Self-monitoring — observation layer stub

**Files:**
- Create: `src/pipeline/observe-events.ts`
- Create: `tests/pipeline/observe-events.test.ts`

This is the "what do you observe?" LLM call over a window of events.

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/llm/client.js", () => ({
  callHaiku: vi.fn(),
}));

import { observeEvents } from "../../src/pipeline/observe-events.js";
import { callHaiku } from "../../src/llm/client.js";
import type { ActivityEvent } from "../../src/adapters/types.js";

const mockedCallHaiku = vi.mocked(callHaiku);

describe("observeEvents", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns observations from Haiku", async () => {
    mockedCallHaiku.mockResolvedValue({
      observations: [
        {
          statement: "Developers keep struggling with auth file imports",
          confidence: "high",
          supportingEventIds: ["e1", "e2"],
          suggestedTags: ["auth", "imports"],
        },
      ],
    });

    const events: ActivityEvent[] = [
      {
        id: "e1",
        timestamp: new Date(),
        category: "struggle",
        tags: [],
        actor: "ai",
        summary: "Circular import in auth module",
        metadata: {},
        sessionId: "s1",
      },
      {
        id: "e2",
        timestamp: new Date(),
        category: "struggle",
        tags: [],
        actor: "ai",
        summary: "Failed to resolve auth imports",
        metadata: {},
        sessionId: "s2",
      },
    ];

    const observations = await observeEvents(events);
    expect(observations).toHaveLength(1);
    expect(observations[0].statement).toContain("auth");
    expect(observations[0].supportingEventIds).toEqual(["e1", "e2"]);
  });

  it("returns empty array when no observations found", async () => {
    mockedCallHaiku.mockResolvedValue({ observations: [] });

    const observations = await observeEvents([]);
    expect(observations).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pipeline/observe-events.test.ts`
Expected: FAIL

**Step 3: Implement**

```typescript
import { callHaiku } from "../llm/client.js";
import type { ActivityEvent } from "../adapters/types.js";
import { z } from "zod";

const ObservationSchema = z.object({
  observations: z.array(z.object({
    statement: z.string(),
    confidence: z.enum(["high", "medium", "low"]).optional().default("medium"),
    supportingEventIds: z.array(z.string()).optional().default([]),
    suggestedTags: z.array(z.string()).optional().default([]),
  })).optional().default([]),
});

export interface Observation {
  statement: string;
  confidence: string;
  supportingEventIds: string[];
  suggestedTags: string[];
}

export async function observeEvents(events: ActivityEvent[]): Promise<Observation[]> {
  if (events.length === 0) return [];

  const eventSummaries = events.map((e) =>
    `[${e.id}] ${e.timestamp.toISOString().slice(0, 16)} | ${e.category} | ${e.actor} | ${e.summary}`
  ).join("\n");

  const systemPrompt = `You observe a stream of development activity events. Your job is to notice anything interesting — recurring themes, knowledge gaps, contradictions, connections across sessions. Report only genuine observations, not restatements. If nothing stands out, return an empty list.`;

  const userPrompt = `Here are recent events:\n\n${eventSummaries}\n\nWhat do you observe? Reference event IDs in supportingEventIds.`;

  const result = await callHaiku(systemPrompt, userPrompt, ObservationSchema);
  return result.observations;
}
```

**Step 4: Run tests**

Run: `npx vitest run tests/pipeline/observe-events.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline/observe-events.ts tests/pipeline/observe-events.test.ts
git commit -m "feat: add observation layer — LLM-driven event stream analysis"
```

---

### Task 10: Wire observation into CLI

**Files:**
- Modify: `src/cli/index.ts`

**Step 1: Add `intent observe-events` command**

```typescript
program
  .command("observe-events")
  .description("Run observation layer over recent activity events")
  .option("--since <date>", "Observe events since date")
  .option("--limit <n>", "Max events to observe", "50")
  .option("--dry-run", "Show observations without emitting")
  .action(async (opts) => {
    const { queryEvents, emitEvents } = await import("../storage/queries.js");
    const { observeEvents } = await import("../pipeline/observe-events.js");
    const { buildObservationEvents } = await import("../pipeline/emit-events.js");

    const events = await queryEvents({
      since: opts.since ? new Date(opts.since) : undefined,
      limit: parseInt(opts.limit),
    });

    process.stderr.write(`Observing ${events.length} events...\n`);

    const observations = await observeEvents(events);

    for (const obs of observations) {
      process.stdout.write(`[${obs.confidence}] ${obs.statement}\n`);
      if (obs.suggestedTags.length) {
        process.stdout.write(`  tags: ${obs.suggestedTags.join(", ")}\n`);
      }
    }

    if (!opts.dryRun && observations.length > 0) {
      // Convert observations to activity events and emit
      const obsEvents = observations.map((obs) => ({
        timestamp: new Date(),
        category: "observation",
        tags: obs.suggestedTags,
        actor: "system",
        summary: obs.statement,
        metadata: {
          confidence: obs.confidence,
          supportingEventIds: obs.supportingEventIds,
        },
      }));
      await emitEvents(obsEvents);
      process.stderr.write(`Emitted ${obsEvents.length} observation events.\n`);
    }

    const { closeDb } = await import("../storage/connection.js");
    await closeDb();
  });
```

**Step 2: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat: add intent observe-events CLI command"
```

---

### Task 11: End-to-end integration test

**Files:**
- Create: `tests/pipeline/event-integration.test.ts`

**Step 1: Write integration test**

This test runs the full flow: digest a fixture → build events → verify event quality → run observation.

```typescript
import { describe, it, expect, vi } from "vitest";

// Mock LLM and DB
vi.mock("../../src/llm/client.js", () => ({
  callSonnet: vi.fn(),
  callHaiku: vi.fn(),
}));
vi.mock("../../src/storage/connection.js", () => ({
  getClient: vi.fn(),
  getDb: vi.fn(),
  closeDb: vi.fn(),
}));

import { buildSessionEvents } from "../../src/pipeline/emit-events.js";
import type { SessionMoment, SessionNarrative, IntentTransition, AcceptedOutcome } from "../../src/adapters/types.js";

describe("event backbone integration", () => {
  it("produces well-formed events from a typical session digest", () => {
    // Use realistic test data (snapshot from a known session)
    const moments: SessionMoment[] = [/* ... */];
    const transitions: IntentTransition[] = [/* ... */];
    const outcomes: AcceptedOutcome[] = [/* ... */];
    const narrative: SessionNarrative = {/* ... */};

    const events = buildSessionEvents({
      sessionId: "test-session",
      repo: "intent-ai",
      branch: "main",
      moments,
      transitions,
      outcomes,
      narrative,
    });

    // Quality checks
    expect(events.length).toBeGreaterThan(0);

    // Every event has required fields
    for (const event of events) {
      expect(event.timestamp).toBeInstanceOf(Date);
      expect(event.category).toBeTruthy();
      expect(event.actor).toBeTruthy();
      expect(event.summary.length).toBeGreaterThan(10);
      expect(event.sessionId).toBe("test-session");
      expect(event.repo).toBe("intent-ai");
    }

    // Has exactly one summary event
    const summaries = events.filter((e) => e.sourceType === "narrative");
    expect(summaries).toHaveLength(1);

    // No duplicate source IDs
    const sourceIds = events.filter((e) => e.sourceId).map((e) => e.sourceId);
    expect(new Set(sourceIds).size).toBe(sourceIds.length);
  });
});
```

**Step 2: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS, including new event tests.

**Step 3: Commit**

```bash
git add tests/pipeline/event-integration.test.ts
git commit -m "test: add end-to-end integration test for event backbone"
```

---

### Task 12: Update documentation

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update the Architecture section**

Add the activity event layer to the pipeline diagram and source layout. Add `intent events` and `intent observe-events` to the Commands section.

**Step 2: Update the How-To section**

Add a how-to for emitting events from new pipeline steps.

**Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with activity event backbone"
```
