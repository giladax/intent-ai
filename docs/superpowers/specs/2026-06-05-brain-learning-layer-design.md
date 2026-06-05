# Brain Learning Layer — Design Spec

> Extend the brain from a knowledge graph into a learning layer that produces patterns, skills, and navigation — queryable by coding agents via MCP mid-session.

## Problem

The brain currently produces **understanding** (topics, insights, file maps). But coding agents need **prescriptions** — how to navigate the codebase, what to watch out for, step-by-step recipes for common tasks. This knowledge exists implicitly in session history but isn't extracted or served.

Teams know they need better agent instructions (AGENTS.md, repo maps, cursor rules) but nobody maintains them manually. The product should auto-generate and maintain these from observed agent behavior.

## Core Loop

```
Record sessions → Detect patterns → Generate skills → Serve via MCP → Observe new sessions → Refine
```

Sessions are training data for a "developer replica" that agents query to navigate the codebase the way the developer would.

## Data Model Extension

### Patterns (new — observed agent behavior)

Attached to brain topics. Detected by clustering repeated requests/struggles across sessions.

```typescript
interface TopicPattern {
  topicId: string;
  type: "request" | "struggle" | "file_access";
  statement: string;          // "agents keep asking where auth middleware lives"
  frequency: number;          // session count
  confidence: "high" | "medium" | "low";
  fileAssociations: string[]; // co-accessed files
  evidence: { sessionId: string; momentId: string }[];
}
```

DB table: `topic_patterns` linked to topics via `topic_id`. Evidence stored as `jsonb` column (matching `brainCards` pattern — read-only, no relational queries needed).

### Skills (new — actionable recipes)

Attached to brain topics. Generated from patterns, human-gated before activation.

```typescript
interface TopicSkill {
  topicId: string;
  name: string;               // "Add API endpoint"
  description: string;
  steps: SkillStep[];
  pitfalls: string[];         // common mistakes from struggle patterns
  files: string[];            // files involved
  status: "draft" | "approved" | "validated";
  evidence: { sessionId: string; momentId: string }[];
}

interface SkillStep {
  order: number;
  instruction: string;        // "create route handler in src/routes/"
  files: string[];            // files for this step
  notes?: string;             // optional context
}
```

DB tables: `topic_skills` (with `steps` and `evidence` as `jsonb` columns — skills are atomic units, no need for join tables). Skills start as `draft` (LLM-generated), move to `approved` (human-reviewed), then `validated` (confirmed by subsequent sessions).

### Insight Category Extension

Existing insight categories (`structure`, `decision`, `constraint`, `behavior`, `risk`, `interface`) gain two new values:

- `navigation` — how to find things, where to start, file access order
- `pitfall` — common mistakes, things agents forget

These flow through the existing insight pipeline — no new tables needed. Requires:
- Drizzle migration: `ALTER TYPE insight_category ADD VALUE 'navigation'` and `'pitfall'`
- Update `InsightCategorySchema` Zod enums in `brain-extract.ts`, `brain-write.ts`
- Update `InsightCategory` type in `types.ts`

### Type Placement

All new types (`TopicPattern`, `TopicSkill`, `SkillStep`) go in `src/adapters/types.ts` per project convention. Zod schemas for LLM output validation go in the respective prompt files (`brain-extract.ts`, `brain-write.ts`) with lenient parsing (`.optional().default([])`).

## Pipeline Extension

Extend the existing 3-node brain pipeline (Extract → Organize → Write). No new pipeline.

### Extract Node (Sonnet, per-session)

Expanded prompt section: extract request signals, struggle signals, and file access sequences from session moments alongside existing knowledge fragments.

`SpecFragmentSchema` in `brain-extract.ts` gains (Zod, lenient):

```typescript
// Added to existing SpecFragmentSchema
requests: z.array(z.object({
  statement: z.string(),
  momentIds: z.array(z.string()),
})).optional().default([]),
struggles: z.array(z.object({
  statement: z.string(),
  momentIds: z.array(z.string()),
})).optional().default([]),
fileSequences: z.array(z.object({
  files: z.array(z.string()),
  context: z.string(),
})).optional().default([]),
```

Purpose question: *"What did agents repeatedly ask for, struggle with, or navigate in this session?"*

### Organize Node (Haiku, single call)

Clusters patterns into topics alongside insights. The Organize prompt gets new instructions to detect when multiple fragments from different sessions contain similar requests/struggles and assign them to the same topic. After Organize assigns fragments to topics, a deterministic dedup step clusters patterns within each topic using the existing `computeSimilarity()` from `dedup.ts` (0.7+ threshold = same pattern, merge evidence).

Purpose question: *"Which requests and struggles belong to which topics, and which are duplicates?"*

### Write Node (Sonnet, per-topic)

Produces enriched specs with new output fields:

```typescript
// Added to existing WrittenSpec
patterns: TopicPattern[];
candidateSkills: TopicSkill[];  // status: "draft"
```

A deterministic gate before the Write node filters: only patterns with evidence from 3+ distinct sessions are passed to the skill generation section of the prompt. This enforces the threshold via code, not prompt instruction (schema constraints > prompt instructions). Skills are always `draft` — human approval required.

Purpose question: *"Given these patterns, what actionable skills should an agent follow when working in this topic area?"*

## MCP Server

REST API routes added to the existing web server (`src/web/server.ts`), not a separate process. MCP server is a thin wrapper that translates MCP tool calls to REST endpoints — can run as a separate process or be embedded in the web server.

### MCP Tools

| Tool | Input | Returns |
|------|-------|---------|
| `search_brain` | `{ query: string }` | Ranked topic cards with matching insights, patterns, skills |
| `get_topic` | `{ topicId: string }` | Full spec: summary, insights, patterns, skills, files |
| `get_skill` | `{ skillId: string }` | Steps, pitfalls, files, evidence links |
| `get_files_context` | `{ files: string[] }` | Topics, insights, patterns touching those files |
| `ask_intent` | `{ query: string }` | Session moments + decisions answering "why was X built this way?" |

### REST API (shared with dashboard)

```
GET /api/brain/search?q=...         → search_brain
GET /api/brain/topics/:id           → get_topic
GET /api/brain/skills/:id           → get_skill
POST /api/brain/files-context       → get_files_context
POST /api/brain/ask-intent          → ask_intent
```

### Search Strategy

Star search pattern (from brain quality vision): query radiates through multiple paths — topic name match, insight text match, pattern statement match, file path match. Nodes matching on multiple paths rank higher.

For `ask_intent`, the query hits session moments and outcomes with evidence, returning grounded answers with citations.

## Scaffold Export

`intent scaffold` generates AGENTS.md — the cross-tool standard (read by Claude Code, Codex, Cursor, Copilot, Gemini CLI, Windsurf, Devin, Amazon Q, Augment, Aider). Future: tool-specific skins (.cursorrules, CLAUDE.md, DESIGN.md) from the same brain data.

The scaffold covers the full taxonomy of agentic scaffold content, not just skills. Each section maps to a brain data source:

```markdown
# Project: <name>

## Overview
[from root topic summaries — project identity, tech stack]

## Architecture
[from `structure` insights — directory layout, data flow, module boundaries]

## Key Files
[from topic file accumulation — entry points, important modules with roles]

## Conventions
[from `constraint` + `behavior` insights — code style, naming, error handling, import patterns]

## Commands
[from session tool_call events — build, test, lint, dev server, migrations]

## Common Workflows
[from approved skills — step-by-step recipes for recurring tasks]

## Domain Rules
[from `decision` + `constraint` insights — data model, API conventions, business logic]

## Watch Out For
[from `pitfall` insights + `struggle` patterns — anti-patterns, common mistakes, forbidden patterns]

## Navigation Guide
[from `navigation` insights + `request` patterns — where things live, common questions answered]

## Testing
[from `constraint` insights on test topics — framework, patterns, what to test]
```

This is a **view** on the brain — regenerated on demand, not a separate data store. Sections are included only when the brain has enough evidence (2+ insights or patterns in that category). Under ~200 lines to stay within agent instruction limits.

## Sync Flow Extension

Brain Sync in the dashboard gains pattern/skill review alongside topic changes:

1. **Discover** — finds undigested sessions (unchanged)
2. **Digest** — runs pipeline on sessions (unchanged)
3. **Propose** — synthesis now includes pattern clusters and candidate skills alongside topic changes
4. **Review** — user sees patterns and draft skills in the diff tree. Can approve, edit, or reject skills. Patterns are informational (auto-accepted). Skills require explicit approval.
5. **Apply** — writes topics + insights + patterns + approved skills to DB. Exports .repo/ markdown. Optionally exports AGENTS.md.

## Input Scope

Claude Code JSONL only for v1. Internal data model (patterns, skills, file sequences) is agent-agnostic — adding Cursor/Codex adapters later is just a new parser feeding the same `SpecFragment` shape.

## Implementation Phases

### Phase 1: Pattern Extraction
- Extend `SpecFragment` type with requests/struggles/fileSequences
- Extend Extract prompt to pull pattern signals
- Extend Write prompt to produce navigation/pitfall insights
- New DB tables: `topic_patterns`
- Verify with existing sessions — run brain on recent digests, inspect pattern output

### Phase 2: Skill Generation
- New DB tables: `topic_skills`, `skill_steps`
- Extend Write prompt to generate candidate skills from patterns
- Extend brain sync review UI for skill approval
- Skill lifecycle: draft → approved → validated

### Phase 3: MCP Server
- REST API endpoints for brain queries
- MCP server wrapping REST
- Star search implementation
- `ask_intent` with session moment retrieval

### Phase 4: Scaffold Export
- `intent scaffold` command
- AGENTS.md template generation from brain
- Integration with brain sync (optional auto-export on apply)

### Phase 5: Validation Loop
- New sessions scored against existing skills (does the agent follow the recipe? does it help?)
- Skills move from `approved` → `validated` when confirmed
- Patterns that stop recurring get confidence downgraded

## Success Criterion

Start a new Claude Code session on this repo → agent connects to MCP → asks "how do I add a pipeline node?" → gets back steps, files, pitfalls, grounded in real session evidence. The agent navigates faster because it queries accumulated knowledge instead of exploring from scratch.
