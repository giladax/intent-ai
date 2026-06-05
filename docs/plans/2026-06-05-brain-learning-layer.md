# Brain Learning Layer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend the brain from a knowledge graph into a learning layer that detects patterns, generates skills, and serves them to coding agents via MCP.

**Architecture:** Extend the existing 3-node brain pipeline (Extract → Organize → Write) with pattern/skill extraction. Add REST endpoints to the existing web server. Wrap with MCP server using `@modelcontextprotocol/sdk` (already a dependency). Brain is the single source of truth — patterns and skills are enrichments on topics.

**Tech Stack:** TypeScript ESM, Drizzle ORM, Zod 4, Express 5, `@modelcontextprotocol/sdk`, Vitest, Anthropic SDK

**Spec:** `docs/superpowers/specs/2026-06-05-brain-learning-layer-design.md`

---

## Phase 1: Pattern Extraction

### Task 1: DB Migration — New Enum Values + Pattern Table

**Files:**
- Create: `drizzle/XXXX_add_patterns.ts` (migration)
- Modify: `src/storage/schema.ts:21-28` (insightCategoryEnum)

**Step 1: Generate the migration**

```bash
npx drizzle-kit generate
```

Then edit the generated migration to contain:

```sql
ALTER TYPE "insight_category" ADD VALUE 'navigation';
ALTER TYPE "insight_category" ADD VALUE 'pitfall';

CREATE TABLE "topic_patterns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "topic_id" uuid NOT NULL REFERENCES "topics"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "statement" text NOT NULL,
  "frequency" integer NOT NULL DEFAULT 1,
  "confidence" text NOT NULL DEFAULT 'medium',
  "file_associations" jsonb NOT NULL DEFAULT '[]',
  "evidence" jsonb NOT NULL DEFAULT '[]',
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
```

**Step 2: Update schema.ts**

In `src/storage/schema.ts`, update `insightCategoryEnum` (line 21) to add the new values:

```typescript
export const insightCategoryEnum = pgEnum("insight_category", [
  "structure", "decision", "constraint", "behavior", "risk", "interface",
  "navigation", "pitfall",
]);
```

Add the new table definition after `brainCards` (after line 341):

```typescript
export const topicPatterns = pgTable("topic_patterns", {
  id: uuid("id").primaryKey().defaultRandom(),
  topicId: uuid("topic_id").notNull().references(() => topics.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // "request" | "struggle" | "file_access"
  statement: text("statement").notNull(),
  frequency: integer("frequency").notNull().default(1),
  confidence: text("confidence").notNull().default("medium"),
  fileAssociations: jsonb("file_associations").notNull().default([]),
  evidence: jsonb("evidence").notNull().default([]),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
```

**Step 3: Run migration**

```bash
npx tsx src/cli/index.ts up
npx drizzle-kit push
```

**Step 4: Commit**

```bash
git add drizzle/ src/storage/schema.ts
git commit -m "feat(db): add topic_patterns table and navigation/pitfall insight categories"
```

---

### Task 2: Extend Types

**Files:**
- Modify: `src/adapters/types.ts:191-197` (InsightCategory)

**Step 1: Update InsightCategory type**

In `src/adapters/types.ts`, update the `InsightCategory` type (line 191):

```typescript
export type InsightCategory =
  | "structure"
  | "decision"
  | "constraint"
  | "behavior"
  | "risk"
  | "interface"
  | "navigation"
  | "pitfall";
```

Add new types after `BrainCard` (after line 282):

```typescript
export interface TopicPattern {
  id?: string;
  topicId: string;
  type: "request" | "struggle" | "file_access";
  statement: string;
  frequency: number;
  confidence: "high" | "medium" | "low";
  fileAssociations: string[];
  evidence: { sessionId: string; momentId?: string }[];
}

export interface TopicSkill {
  id?: string;
  topicId: string;
  name: string;
  description: string;
  steps: SkillStep[];
  pitfalls: string[];
  files: string[];
  status: "draft" | "approved" | "validated";
  evidence: { sessionId: string; momentId?: string }[];
}

export interface SkillStep {
  order: number;
  instruction: string;
  files: string[];
  notes?: string;
}
```

**Step 2: Type check**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/adapters/types.ts
git commit -m "feat(types): add TopicPattern, TopicSkill, SkillStep types and new insight categories"
```

---

### Task 3: Extend Extract Schema + Prompt

**Files:**
- Modify: `src/llm/prompts/brain-extract.ts:20-78` (SpecFragmentSchema)
- Test: `tests/pipeline/brain-extract.test.ts`

**Step 1: Write failing tests**

Add to `tests/pipeline/brain-extract.test.ts`:

```typescript
it("parses fragments with requests, struggles, and fileSequences", () => {
  const raw = {
    fragments: [{
      nameHint: "Pipeline",
      insights: { structure: [{ statement: "uses two passes", confidence: 85 }] },
      fileRefs: [{ path: "src/pipeline/orchestrator.ts", role: "core" }],
      requests: [{ statement: "how does the pipeline work?", momentIds: ["m1"] }],
      struggles: [{ statement: "forgot to update orchestrator", momentIds: ["m2"] }],
      fileSequences: [{ files: ["types.ts", "orchestrator.ts"], context: "adding a node" }],
    }],
  };
  const result = SpecFragmentOutputSchema.parse(raw);
  expect(result.fragments[0].requests).toHaveLength(1);
  expect(result.fragments[0].requests[0].statement).toBe("how does the pipeline work?");
  expect(result.fragments[0].struggles).toHaveLength(1);
  expect(result.fragments[0].fileSequences).toHaveLength(1);
});

it("defaults requests/struggles/fileSequences to empty arrays", () => {
  const raw = {
    fragments: [{
      nameHint: "Pipeline",
      insights: { structure: [{ statement: "test", confidence: 80 }] },
      fileRefs: [],
    }],
  };
  const result = SpecFragmentOutputSchema.parse(raw);
  expect(result.fragments[0].requests).toEqual([]);
  expect(result.fragments[0].struggles).toEqual([]);
  expect(result.fragments[0].fileSequences).toEqual([]);
});
```

**Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/pipeline/brain-extract.test.ts -v
```

Expected: FAIL — `requests` property does not exist on fragment.

**Step 3: Extend SpecFragmentSchema**

In `src/llm/prompts/brain-extract.ts`, add to `SpecFragmentSchema` (inside the z.object, before the closing):

```typescript
requests: z.array(z.object({
  statement: z.string(),
  momentIds: z.array(z.string()).optional().default([]),
})).optional().default([]),
struggles: z.array(z.object({
  statement: z.string(),
  momentIds: z.array(z.string()).optional().default([]),
})).optional().default([]),
fileSequences: z.array(z.object({
  files: z.array(z.string()),
  context: z.string(),
})).optional().default([]),
```

**Step 4: Extend the prompt**

In the `buildBrainExtractPrompt` function, add a new section to the system prompt after the existing extraction instructions:

```typescript
## ALSO EXTRACT: Agent Behavior Signals

For each fragment, also extract:

### requests[]
What was the agent asked to do or find? Direct requests from the developer.
- "find where auth is handled"
- "add a new pipeline node"
- "explain the chunking logic"
Each request needs the momentId(s) where it appeared.

### struggles[]
Where did the agent struggle, retry, or make mistakes?
- "opened wrong file first"
- "forgot to update types.ts after schema change"
- "had to retry migration 3 times"
Each struggle needs the momentId(s) where it was observed.

### fileSequences[]
What files were accessed together, in what order, for what purpose?
- files: ["types.ts", "orchestrator.ts", "tests/pipeline/"], context: "adding a pipeline node"
Only include sequences of 2+ files that represent a meaningful workflow.
```

Also update the `InsightCategorySchema` Zod enum to include the new categories:

```typescript
const InsightCategorySchema = z.enum([
  "structure", "decision", "constraint", "behavior", "risk", "interface",
  "navigation", "pitfall",
]);
```

**Step 5: Run tests to verify they pass**

```bash
npx vitest run tests/pipeline/brain-extract.test.ts -v
```

Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/llm/prompts/brain-extract.ts tests/pipeline/brain-extract.test.ts
git commit -m "feat(extract): add requests, struggles, fileSequences to SpecFragment schema and prompt"
```

---

### Task 4: Extend Write Schema + Prompt

**Files:**
- Modify: `src/llm/prompts/brain-write.ts:6-77` (WrittenSpecSchema)
- Test: `tests/pipeline/brain-write.test.ts`

**Step 1: Write failing tests**

Add to `tests/pipeline/brain-write.test.ts`:

```typescript
it("parses written spec with patterns", () => {
  const raw = {
    name: "Pipeline",
    summary: "Core pipeline system",
    insights: { structure: [{ statement: "two-pass", confidence: 80 }] },
    fileRefs: [{ path: "src/pipeline/orchestrator.ts", role: "core" }],
    patterns: [{
      type: "request",
      statement: "agents ask how to add pipeline nodes",
      frequency: 3,
      confidence: "high",
      fileAssociations: ["orchestrator.ts", "types.ts"],
      evidence: [{ sessionId: "s1", momentId: "m1" }],
    }],
  };
  const result = WrittenSpecSchema.parse(raw);
  expect(result.patterns).toHaveLength(1);
  expect(result.patterns[0].type).toBe("request");
});

it("defaults patterns to empty array", () => {
  const raw = {
    name: "Pipeline",
    summary: "Core pipeline",
    insights: { structure: [{ statement: "test", confidence: 80 }] },
    fileRefs: [],
  };
  const result = WrittenSpecSchema.parse(raw);
  expect(result.patterns).toEqual([]);
});
```

**Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/pipeline/brain-write.test.ts -v
```

**Step 3: Extend WrittenSpecSchema**

In `src/llm/prompts/brain-write.ts`, add to `WrittenSpecSchema`:

```typescript
patterns: z.array(z.object({
  type: z.enum(["request", "struggle", "file_access"]),
  statement: z.string(),
  frequency: z.number().optional().default(1),
  confidence: z.enum(["high", "medium", "low"]).optional().default("medium"),
  fileAssociations: z.array(z.string()).optional().default([]),
  evidence: z.array(z.object({
    sessionId: z.string().optional().default(""),
    momentId: z.string().optional().default(""),
  })).optional().default([]),
})).optional().default([]),
```

Also update `InsightCategorySchema` in brain-write.ts:

```typescript
const InsightCategorySchema = z.enum([
  "structure", "decision", "constraint", "behavior", "risk", "interface",
  "navigation", "pitfall",
]);
```

**Step 4: Extend the Write prompt**

In `buildBrainWritePrompt`, add to the system prompt:

```typescript
## PATTERNS

If the fragments contain requests[], struggles[], or fileSequences[], synthesize them into a `patterns` array on the spec.

Each pattern has:
- type: "request" (agents keep asking this) | "struggle" (agents keep failing at this) | "file_access" (these files are always accessed together)
- statement: what the pattern is, in plain language
- frequency: how many sessions show this pattern
- confidence: high (4+ sessions) | medium (2-3) | low (1)
- fileAssociations: files involved in this pattern
- evidence: [{sessionId, momentId}] — cite the source moments

Merge similar patterns from different fragments. Deduplicate — if two fragments describe the same request, combine into one pattern with merged evidence.

Also produce `navigation` and `pitfall` insights from patterns:
- A recurring request becomes a `navigation` insight: "Auth middleware is in src/middleware/auth.ts — agents frequently ask about this"
- A recurring struggle becomes a `pitfall` insight: "When adding endpoints, agents forget to update OpenAPI spec"
```

**Step 5: Run tests to verify they pass**

```bash
npx vitest run tests/pipeline/brain-write.test.ts -v
```

**Step 6: Commit**

```bash
git add src/llm/prompts/brain-write.ts tests/pipeline/brain-write.test.ts
git commit -m "feat(write): add patterns output and navigation/pitfall insight generation"
```

---

### Task 5: Pattern Dedup + Storage in brain-apply

**Files:**
- Modify: `src/pipeline/brain-apply.ts:284-344` (storeSpecContent)
- Modify: `src/pipeline/brain-synthesis.ts:447-594` (synthesizeV2)
- Test: `tests/pipeline/brain-apply.test.ts`

**Step 1: Write failing test**

Add to `tests/pipeline/brain-apply.test.ts` (or create if needed):

```typescript
import { deduplicatePatterns } from "../src/pipeline/brain-apply.js";
import { computeSimilarity } from "../src/pipeline/dedup.js";

describe("deduplicatePatterns", () => {
  it("merges similar patterns, keeps highest frequency", () => {
    const patterns = [
      { type: "request", statement: "how does the pipeline work", frequency: 3, evidence: [{ sessionId: "s1" }] },
      { type: "request", statement: "how does the pipeline function", frequency: 1, evidence: [{ sessionId: "s2" }] },
      { type: "struggle", statement: "forgot to update types", frequency: 2, evidence: [{ sessionId: "s3" }] },
    ];
    const deduped = deduplicatePatterns(patterns);
    expect(deduped).toHaveLength(2); // two similar requests merged
    expect(deduped[0].frequency).toBe(4); // frequencies summed
    expect(deduped[0].evidence).toHaveLength(2); // evidence merged
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run tests/pipeline/brain-apply.test.ts -v
```

**Step 3: Implement deduplicatePatterns**

Add to `src/pipeline/brain-apply.ts`:

```typescript
import { computeSimilarity } from "./dedup.js";

export function deduplicatePatterns(
  patterns: Array<{
    type: string;
    statement: string;
    frequency: number;
    confidence?: string;
    fileAssociations?: string[];
    evidence: Array<{ sessionId: string; momentId?: string }>;
  }>,
  threshold = 0.7,
) {
  const result = [...patterns];
  const toRemove = new Set<number>();

  for (let i = 0; i < result.length; i++) {
    if (toRemove.has(i)) continue;
    for (let j = i + 1; j < result.length; j++) {
      if (toRemove.has(j)) continue;
      if (result[i].type !== result[j].type) continue; // only merge same type
      const score = computeSimilarity(result[i].statement, result[j].statement);
      if (score >= threshold) {
        // Merge j into i
        result[i].frequency += result[j].frequency;
        result[i].evidence = [...result[i].evidence, ...result[j].evidence];
        result[i].fileAssociations = [
          ...new Set([...(result[i].fileAssociations ?? []), ...(result[j].fileAssociations ?? [])]),
        ];
        // Keep higher confidence
        const confOrder = { high: 3, medium: 2, low: 1 };
        const ci = confOrder[(result[i].confidence ?? "medium") as keyof typeof confOrder] ?? 2;
        const cj = confOrder[(result[j].confidence ?? "medium") as keyof typeof confOrder] ?? 2;
        if (cj > ci) result[i].confidence = result[j].confidence;
        toRemove.add(j);
      }
    }
  }

  return result.filter((_, idx) => !toRemove.has(idx));
}
```

**Step 4: Store patterns in storeSpecContent**

In `src/pipeline/brain-apply.ts`, extend `storeSpecContent` to also store patterns. After the insight/evidence/file storage block, add:

```typescript
// Store patterns (if WrittenSpec has them)
if (spec.patterns?.length) {
  const deduped = deduplicatePatterns(spec.patterns);
  for (const pattern of deduped) {
    await sql.insert(topicPatterns).values({
      topicId,
      type: pattern.type,
      statement: pattern.statement,
      frequency: pattern.frequency,
      confidence: pattern.confidence ?? "medium",
      fileAssociations: pattern.fileAssociations ?? [],
      evidence: pattern.evidence ?? [],
    });
  }
}
```

Import `topicPatterns` from schema.

**Step 5: Run tests**

```bash
npx vitest run tests/pipeline/brain-apply.test.ts -v
```

**Step 6: Commit**

```bash
git add src/pipeline/brain-apply.ts tests/pipeline/brain-apply.test.ts
git commit -m "feat(apply): store patterns with dedup during brain synthesis"
```

---

### Task 6: Verify Phase 1 End-to-End

**Files:** None (integration test)

**Step 1: Run full test suite**

```bash
npx vitest run
npx tsc --noEmit
```

**Step 2: Run brain synthesis on existing sessions (dry run)**

```bash
npx tsx src/cli/index.ts up
npx tsx src/cli/index.ts brain --dry-run <sessionId>
```

Inspect output — fragments should now include `requests`, `struggles`, `fileSequences` arrays (possibly empty for older sessions that don't have strong signals).

**Step 3: Run real synthesis on a session**

```bash
npx tsx src/cli/index.ts brain <sessionId>
```

Verify in DB that `topic_patterns` has rows.

**Step 4: Commit any fixes**

```bash
git commit -m "fix: phase 1 integration fixes"
```

---

## Phase 2: Skill Generation

### Task 7: DB Migration — Skills Table

**Files:**
- Create: `drizzle/XXXX_add_skills.ts`
- Modify: `src/storage/schema.ts`

**Step 1: Add table to schema.ts**

After `topicPatterns`:

```typescript
export const skillStatusEnum = pgEnum("skill_status", [
  "draft", "approved", "validated",
]);

export const topicSkills = pgTable("topic_skills", {
  id: uuid("id").primaryKey().defaultRandom(),
  topicId: uuid("topic_id").notNull().references(() => topics.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  steps: jsonb("steps").notNull().default([]),
  pitfalls: jsonb("pitfalls").notNull().default([]),
  files: jsonb("files").notNull().default([]),
  status: skillStatusEnum("status").notNull().default("draft"),
  evidence: jsonb("evidence").notNull().default([]),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
```

**Step 2: Generate and run migration**

```bash
npx drizzle-kit generate
npx drizzle-kit push
```

**Step 3: Commit**

```bash
git add drizzle/ src/storage/schema.ts
git commit -m "feat(db): add topic_skills table with skill_status enum"
```

---

### Task 8: Extend Write Schema + Prompt for Skills

**Files:**
- Modify: `src/llm/prompts/brain-write.ts`
- Test: `tests/pipeline/brain-write.test.ts`

**Step 1: Write failing test**

```typescript
it("parses written spec with candidateSkills", () => {
  const raw = {
    name: "Pipeline",
    summary: "Core pipeline",
    insights: { structure: [{ statement: "test", confidence: 80 }] },
    fileRefs: [],
    patterns: [],
    candidateSkills: [{
      name: "Add Pipeline Node",
      description: "Steps to add a new processing node",
      steps: [
        { order: 1, instruction: "Create src/pipeline/<name>.ts", files: ["src/pipeline/"] },
        { order: 2, instruction: "Add types to types.ts", files: ["src/adapters/types.ts"] },
      ],
      pitfalls: ["Don't forget to wire into orchestrator.ts"],
      files: ["src/pipeline/", "src/adapters/types.ts", "src/pipeline/orchestrator.ts"],
      evidence: [{ sessionId: "s1", momentId: "m1" }],
    }],
  };
  const result = WrittenSpecSchema.parse(raw);
  expect(result.candidateSkills).toHaveLength(1);
  expect(result.candidateSkills[0].steps).toHaveLength(2);
});
```

**Step 2: Run test — should fail**

```bash
npx vitest run tests/pipeline/brain-write.test.ts -v
```

**Step 3: Add candidateSkills to WrittenSpecSchema**

```typescript
candidateSkills: z.array(z.object({
  name: z.string(),
  description: z.string().optional().default(""),
  steps: z.array(z.object({
    order: z.number(),
    instruction: z.string(),
    files: z.array(z.string()).optional().default([]),
    notes: z.string().optional(),
  })),
  pitfalls: z.array(z.string()).optional().default([]),
  files: z.array(z.string()).optional().default([]),
  evidence: z.array(z.object({
    sessionId: z.string().optional().default(""),
    momentId: z.string().optional().default(""),
  })).optional().default([]),
})).optional().default([]),
```

**Step 4: Extend Write prompt**

Add to `buildBrainWritePrompt` system prompt:

```
## CANDIDATE SKILLS

If you receive patterns with frequency 3+ (from 3+ distinct sessions), generate candidateSkills.

A skill is a step-by-step recipe for a common task in this topic area.

Each skill has:
- name: short action name ("Add Pipeline Node", "Debug Migration Failure")
- description: one sentence explaining when to use this
- steps: ordered [{order, instruction, files, notes?}] — concrete, actionable
- pitfalls: common mistakes from struggle patterns
- files: all files involved across all steps
- evidence: cite the pattern/moment sources

Only generate skills when you have STRONG pattern evidence (3+ sessions). Quality over quantity.
Do NOT generate skills for one-off tasks or session-specific work.
```

**Step 5: Add deterministic gate in brain-synthesis.ts**

In `synthesizeV2`, before calling the Write node, filter pattern data:

```typescript
// Deterministic gate: only pass patterns with 3+ session evidence to Write
for (const input of writeInputs) {
  if (input.fragments) {
    for (const frag of input.fragments) {
      // Count distinct sessions across all requests/struggles
      const sessionSet = new Set<string>();
      for (const r of frag.requests ?? []) {
        // momentIds → look up sessionId from moment map
        // For now, count fragments as session proxies since each fragment = 1 session
      }
      // Filter: only keep requests/struggles that appear across fragments
    }
  }
}
```

The exact implementation: in `identifyChangedSpecs` (line 354), when grouping fragments by spec, also aggregate requests/struggles across fragments and count distinct session sources. Only pass aggregated patterns with 3+ session sources to the Write input.

**Step 6: Run tests**

```bash
npx vitest run tests/pipeline/brain-write.test.ts -v
```

**Step 7: Store skills in brain-apply**

Extend `storeSpecContent` in `brain-apply.ts`:

```typescript
// Store candidate skills (always as draft)
if (spec.candidateSkills?.length) {
  for (const skill of spec.candidateSkills) {
    await sql.insert(topicSkills).values({
      topicId,
      name: skill.name,
      description: skill.description ?? "",
      steps: skill.steps,
      pitfalls: skill.pitfalls ?? [],
      files: skill.files ?? [],
      status: "draft",
      evidence: skill.evidence ?? [],
    });
  }
}
```

**Step 8: Commit**

```bash
git add src/llm/prompts/brain-write.ts src/pipeline/brain-apply.ts src/pipeline/brain-synthesis.ts tests/pipeline/brain-write.test.ts
git commit -m "feat(skills): generate candidate skills from patterns, store as draft"
```

---

## Phase 3: MCP Server

### Task 9: REST API Endpoints

**Files:**
- Modify: `src/web/server.ts`
- Test: Manual via curl

**Step 1: Add brain search endpoint**

In `src/web/server.ts`, after existing brain card endpoints (~line 429), add:

```typescript
// --- Brain Learning Layer API ---

app.get("/api/brain/search", async (req, res) => {
  const { q, repoId } = req.query;
  if (!q || !repoId) return res.status(400).json({ error: "q and repoId required" });

  const query = String(q).toLowerCase();
  const repo = String(repoId);

  // Star search: topic name + insight text + pattern statement + file path
  const allTopics = await db.select().from(topics).where(eq(topics.repoId, repo));
  const allInsights = await db.select().from(insights);
  const allPatterns = await db.select().from(topicPatterns);

  const scored = allTopics.map((topic) => {
    let score = 0;
    // Name match
    if (topic.name.toLowerCase().includes(query)) score += 3;
    if (topic.summary?.toLowerCase().includes(query)) score += 2;
    // Insight match
    const topicInsights = allInsights.filter((i) => i.topicId === topic.id);
    for (const ins of topicInsights) {
      if (ins.statement.toLowerCase().includes(query)) score += 1;
    }
    // Pattern match
    const topicPats = allPatterns.filter((p) => p.topicId === topic.id);
    for (const pat of topicPats) {
      if (pat.statement.toLowerCase().includes(query)) score += 2;
    }
    return { topic, insights: topicInsights, patterns: topicPats, score };
  }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, 10);

  res.json(scored);
});

app.get("/api/brain/topics/:id/full", async (req, res) => {
  const { id } = req.params;
  const topic = await db.select().from(topics).where(eq(topics.id, id)).limit(1);
  if (!topic.length) return res.status(404).json({ error: "topic not found" });

  const topicInsights = await db.select().from(insights).where(eq(insights.topicId, id));
  const patterns = await db.select().from(topicPatterns).where(eq(topicPatterns.topicId, id));
  const skills = await db.select().from(topicSkills).where(eq(topicSkills.topicId, id));
  const files = await db.select().from(topicFiles).where(eq(topicFiles.topicId, id));

  res.json({ ...topic[0], insights: topicInsights, patterns, skills, files });
});

app.get("/api/brain/skills/:id", async (req, res) => {
  const { id } = req.params;
  const skill = await db.select().from(topicSkills).where(eq(topicSkills.id, id)).limit(1);
  if (!skill.length) return res.status(404).json({ error: "skill not found" });
  res.json(skill[0]);
});

app.post("/api/brain/files-context", async (req, res) => {
  const { files, repoId } = req.body;
  if (!files?.length || !repoId) return res.status(400).json({ error: "files and repoId required" });

  const allTopicFiles = await db.select().from(topicFiles);
  const matchingTopicIds = new Set(
    allTopicFiles.filter((tf) => files.some((f: string) => tf.filePath.includes(f) || f.includes(tf.filePath)))
      .map((tf) => tf.topicId),
  );

  const matchedTopics = await db.select().from(topics).where(eq(topics.repoId, repoId));
  const relevant = matchedTopics.filter((t) => matchingTopicIds.has(t.id));

  const result = await Promise.all(relevant.map(async (t) => ({
    topic: t,
    insights: await db.select().from(insights).where(eq(insights.topicId, t.id)),
    patterns: await db.select().from(topicPatterns).where(eq(topicPatterns.topicId, t.id)),
  })));

  res.json(result);
});

app.post("/api/brain/ask-intent", async (req, res) => {
  const { query, repoId } = req.body;
  if (!query || !repoId) return res.status(400).json({ error: "query and repoId required" });

  // Find relevant moments and outcomes across sessions
  const allSessions = await db.select().from(sessions).where(eq(sessions.repoId, repoId));
  const allMoments = await db.select().from(moments);
  const allOutcomes = await db.select().from(outcomes);
  const allNarratives = await db.select().from(narratives);

  // Simple text search for now — can upgrade to embeddings later
  const q = String(query).toLowerCase();
  const matchingMoments = allMoments.filter((m) =>
    m.statement?.toLowerCase().includes(q) || m.significance?.toLowerCase().includes(q),
  );
  const matchingOutcomes = allOutcomes.filter((o) =>
    o.statement?.toLowerCase().includes(q),
  );

  res.json({
    moments: matchingMoments.slice(0, 20),
    outcomes: matchingOutcomes.slice(0, 10),
    narratives: allNarratives.filter((n) =>
      n.summary?.toLowerCase().includes(q),
    ).slice(0, 5),
  });
});
```

Add necessary imports at top of server.ts for the new tables.

**Step 2: Test with curl**

```bash
curl "http://localhost:3456/api/brain/search?q=pipeline&repoId=<id>"
curl -X POST http://localhost:3456/api/brain/files-context -H "Content-Type: application/json" -d '{"files":["src/pipeline/orchestrator.ts"],"repoId":"<id>"}'
```

**Step 3: Commit**

```bash
git add src/web/server.ts
git commit -m "feat(api): add brain search, files-context, ask-intent REST endpoints"
```

---

### Task 10: MCP Server

**Files:**
- Create: `src/mcp/server.ts`
- Modify: `src/cli/index.ts` (add `mcp` command)

**Step 1: Create MCP server**

```typescript
// src/mcp/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = process.env.INTENT_API_URL ?? "http://localhost:3456";

async function fetchJson(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function startMcpServer(repoId: string) {
  const server = new McpServer({
    name: "intent-brain",
    version: "1.0.0",
  });

  server.tool(
    "search_brain",
    "Search the repo knowledge graph. Returns topics, insights, patterns, and skills matching your query.",
    { query: z.string().describe("Free-text search query") },
    async ({ query }) => {
      const results = await fetchJson(`/api/brain/search?q=${encodeURIComponent(query)}&repoId=${repoId}`);
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    },
  );

  server.tool(
    "get_topic",
    "Get full details for a brain topic: insights, patterns, skills, and files.",
    { topicId: z.string().describe("Topic UUID") },
    async ({ topicId }) => {
      const result = await fetchJson(`/api/brain/topics/${topicId}/full`);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "get_skill",
    "Get a step-by-step skill/recipe for a common task.",
    { skillId: z.string().describe("Skill UUID") },
    async ({ skillId }) => {
      const result = await fetchJson(`/api/brain/skills/${skillId}`);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "get_files_context",
    "Get brain context for specific files: which topics, insights, and patterns relate to these files.",
    { files: z.array(z.string()).describe("File paths to get context for") },
    async ({ files }) => {
      const result = await fetchJson("/api/brain/files-context", {
        method: "POST",
        body: JSON.stringify({ files, repoId }),
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "ask_intent",
    "Ask why something was built a certain way. Returns session moments and decisions with evidence.",
    { query: z.string().describe("Question about intent, e.g. 'why was auth refactored?'") },
    async ({ query }) => {
      const result = await fetchJson("/api/brain/ask-intent", {
        method: "POST",
        body: JSON.stringify({ query, repoId }),
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
```

**Step 2: Add CLI command**

In `src/cli/index.ts`, add:

```typescript
program
  .command("mcp")
  .description("Start MCP server for brain queries")
  .requiredOption("--repo <repoId>", "Repository ID")
  .option("--api-url <url>", "API base URL", "http://localhost:3456")
  .action(async (opts) => {
    process.env.INTENT_API_URL = opts.apiUrl;
    const { startMcpServer } = await import("../mcp/server.js");
    await startMcpServer(opts.repo);
  });
```

**Step 3: Test MCP server**

```bash
# Terminal 1: start web server
npx tsx src/cli/index.ts web --port 3456

# Terminal 2: test MCP via stdio
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | npx tsx src/cli/index.ts mcp --repo <repoId>
```

**Step 4: Commit**

```bash
git add src/mcp/server.ts src/cli/index.ts
git commit -m "feat(mcp): add intent-brain MCP server with 5 brain query tools"
```

---

### Task 11: Claude Code MCP Integration Config

**Files:**
- Create: `.mcp.json` (or document in README)

**Step 1: Create MCP config for Claude Code**

Create a sample `.mcp.json` for this repo:

```json
{
  "mcpServers": {
    "intent-brain": {
      "command": "npx",
      "args": ["tsx", "src/cli/index.ts", "mcp", "--repo", "<REPO_ID>"],
      "cwd": "/Users/giladkoch/dev/intent-ai"
    }
  }
}
```

**Step 2: Commit**

```bash
git add .mcp.json
git commit -m "feat(mcp): add Claude Code MCP config for intent-brain"
```

---

## Phase 4: Scaffold Export

### Task 12: AGENTS.md Generator

**Files:**
- Create: `src/brain/generate-scaffold.ts`
- Modify: `src/cli/index.ts` (add `scaffold` command)
- Test: `tests/brain/generate-scaffold.test.ts`

**Step 1: Write failing test**

```typescript
// tests/brain/generate-scaffold.test.ts
import { describe, it, expect } from "vitest";
import { generateAgentsMd } from "../../src/brain/generate-scaffold.js";

describe("generateAgentsMd", () => {
  it("generates AGENTS.md from brain data", () => {
    const input = {
      projectName: "intent-ai",
      topics: [
        {
          name: "Core Pipeline",
          summary: "The processing pipeline",
          insights: [
            { category: "navigation", statement: "Pipeline starts at orchestrator.ts" },
            { category: "pitfall", statement: "Always update types.ts when adding nodes" },
          ],
          patterns: [
            { type: "request", statement: "how to add a pipeline node", frequency: 4 },
          ],
          skills: [
            {
              name: "Add Pipeline Node",
              status: "approved",
              steps: [
                { order: 1, instruction: "Create src/pipeline/<name>.ts", files: [] },
                { order: 2, instruction: "Add types to types.ts", files: [] },
              ],
              pitfalls: ["Wire into orchestrator.ts"],
              files: ["src/pipeline/", "src/adapters/types.ts"],
            },
          ],
          files: [{ path: "src/pipeline/orchestrator.ts", role: "core" }],
        },
      ],
    };

    const md = generateAgentsMd(input);
    expect(md).toContain("# intent-ai");
    expect(md).toContain("## Common Workflows");
    expect(md).toContain("Add Pipeline Node");
    expect(md).toContain("## Watch Out For");
    expect(md).toContain("Always update types.ts");
    expect(md).toContain("## Navigation Guide");
    expect(md).toContain("Pipeline starts at orchestrator.ts");
  });
});
```

**Step 2: Run test — should fail**

```bash
npx vitest run tests/brain/generate-scaffold.test.ts -v
```

**Step 3: Implement**

```typescript
// src/brain/generate-scaffold.ts

interface ScaffoldTopic {
  name: string;
  summary: string;
  insights: Array<{ category: string; statement: string }>;
  patterns: Array<{ type: string; statement: string; frequency: number }>;
  skills: Array<{
    name: string;
    status: string;
    steps: Array<{ order: number; instruction: string; files: string[] }>;
    pitfalls: string[];
    files: string[];
  }>;
  files: Array<{ path: string; role: string }>;
}

interface ScaffoldInput {
  projectName: string;
  topics: ScaffoldTopic[];
}

export function generateAgentsMd(input: ScaffoldInput): string {
  const lines: string[] = [];

  lines.push(`# ${input.projectName}`);
  lines.push("");

  // Overview from root topic summaries
  lines.push("## Overview");
  lines.push("");
  for (const t of input.topics) {
    lines.push(`**${t.name}:** ${t.summary}`);
    lines.push("");
  }

  // File map
  lines.push("## Key Files");
  lines.push("");
  for (const t of input.topics) {
    if (t.files.length) {
      lines.push(`### ${t.name}`);
      for (const f of t.files) {
        lines.push(`- \`${f.path}\` — ${f.role}`);
      }
      lines.push("");
    }
  }

  // Common workflows from approved/validated skills
  const allSkills = input.topics.flatMap((t) =>
    t.skills.filter((s) => s.status === "approved" || s.status === "validated"),
  );
  if (allSkills.length) {
    lines.push("## Common Workflows");
    lines.push("");
    for (const skill of allSkills) {
      lines.push(`### ${skill.name}`);
      lines.push("");
      for (const step of skill.steps) {
        lines.push(`${step.order}. ${step.instruction}`);
      }
      if (skill.pitfalls.length) {
        lines.push("");
        lines.push("**Watch out:**");
        for (const p of skill.pitfalls) {
          lines.push(`- ${p}`);
        }
      }
      lines.push("");
    }
  }

  // Pitfalls from pitfall insights + struggle patterns
  const pitfalls = input.topics.flatMap((t) =>
    t.insights.filter((i) => i.category === "pitfall"),
  );
  const struggles = input.topics.flatMap((t) =>
    t.patterns.filter((p) => p.type === "struggle"),
  );
  if (pitfalls.length || struggles.length) {
    lines.push("## Watch Out For");
    lines.push("");
    for (const p of pitfalls) lines.push(`- ${p.statement}`);
    for (const s of struggles) lines.push(`- ${s.statement} (seen in ${s.frequency} sessions)`);
    lines.push("");
  }

  // Navigation from navigation insights + request patterns
  const navInsights = input.topics.flatMap((t) =>
    t.insights.filter((i) => i.category === "navigation"),
  );
  const requests = input.topics.flatMap((t) =>
    t.patterns.filter((p) => p.type === "request"),
  );
  if (navInsights.length || requests.length) {
    lines.push("## Navigation Guide");
    lines.push("");
    for (const n of navInsights) lines.push(`- ${n.statement}`);
    for (const r of requests) lines.push(`- Common question: "${r.statement}" (asked in ${r.frequency} sessions)`);
    lines.push("");
  }

  return lines.join("\n");
}
```

**Step 4: Run tests**

```bash
npx vitest run tests/brain/generate-scaffold.test.ts -v
```

**Step 5: Add CLI command**

In `src/cli/index.ts`:

```typescript
program
  .command("scaffold")
  .description("Generate AGENTS.md from brain knowledge")
  .option("--repo <repoId>", "Repository ID")
  .option("--output <path>", "Output path", "AGENTS.md")
  .action(async (opts) => {
    // Load topics with insights, patterns, skills from DB
    // Call generateAgentsMd()
    // Write to output path
  });
```

**Step 6: Commit**

```bash
git add src/brain/generate-scaffold.ts src/cli/index.ts tests/brain/generate-scaffold.test.ts
git commit -m "feat(scaffold): generate AGENTS.md from brain knowledge graph"
```

---

### Task 13: Extend Markdown Export with Patterns

**Files:**
- Modify: `src/brain/generate-markdown.ts`

**Step 1: Extend topic markdown to include patterns and skills**

In `generateTopicMarkdown`, after the insights section, add:

```typescript
// Patterns section
const patterns = await db.select().from(topicPatterns).where(eq(topicPatterns.topicId, topic.id));
if (patterns.length) {
  lines.push("## Patterns");
  lines.push("");
  for (const p of patterns) {
    const icon = p.type === "request" ? "?" : p.type === "struggle" ? "!" : "~";
    lines.push(`- ${icon} **${p.type}**: ${p.statement} (${p.frequency} sessions, ${p.confidence})`);
  }
  lines.push("");
}

// Skills section
const skills = await db.select().from(topicSkills).where(eq(topicSkills.topicId, topic.id));
const activeSkills = skills.filter((s) => s.status !== "draft");
if (activeSkills.length) {
  lines.push("## Skills");
  lines.push("");
  for (const skill of activeSkills) {
    lines.push(`### ${skill.name}`);
    lines.push("");
    for (const step of skill.steps as any[]) {
      lines.push(`${step.order}. ${step.instruction}`);
    }
    lines.push("");
  }
}
```

**Step 2: Commit**

```bash
git add src/brain/generate-markdown.ts
git commit -m "feat(export): include patterns and skills in .repo/ topic markdown"
```

---

### Task 14: Final Integration Test — Dogfood

**Step 1: Full pipeline run**

```bash
npx tsx src/cli/index.ts up
npx tsx src/cli/index.ts digest --last 3
npx tsx src/cli/index.ts brain <session1> <session2> <session3>
npx tsx src/cli/index.ts brain-export
npx tsx src/cli/index.ts scaffold
```

**Step 2: Verify outputs**

- Check `.repo/topics/*.md` includes Patterns and Skills sections
- Check `AGENTS.md` has Common Workflows, Watch Out For, Navigation Guide
- Check DB has `topic_patterns` and `topic_skills` rows

**Step 3: Start MCP and test**

```bash
# Terminal 1
npx tsx src/cli/index.ts web --port 3456

# Terminal 2 — test search
curl "http://localhost:3456/api/brain/search?q=pipeline&repoId=<id>"
```

**Step 4: Connect Claude Code to MCP**

Update `.mcp.json` with real repo ID, restart Claude Code, and test:
- "How do I add a pipeline node?"
- "What files are involved in brain synthesis?"
- "Why was the two-pass moment detection chosen?"

**Step 5: Commit any fixes**

```bash
git commit -m "fix: integration fixes from dogfood testing"
```
