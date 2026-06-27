# Handoff: Repo Brain — Versioned Knowledge from Code and Sessions

**Date:** 2026-05-23
**From:** Session that digested brain/telegram/telegram-tmp sessions and tested the dashboard
**For:** Successor implementing the Repo Brain

## The Intent

Build a **versioned knowledge system** for repositories. Not documentation. Not summaries. A controlled, evidence-backed graph of insights that evolves with every PR.

The product statement: **each brain commit explains what the code commit means.**

## The Doctrine

The repo brain is **not regenerated from scratch**. It is **evolved through controlled, evidence-backed commits** — just like code.

```
Code has commits.
Brain has commits.
```

The static code tree is context for synthesis, not the source of truth. The source of truth is the controlled update:

```
brain version N
→ PR/session evidence
→ brain mutation
→ brain version N+1
```

Only reviewed, evidence-backed insights enter the brain.

## What the Brain Contains

Not just features. The brain is the full semantic map of a repo:

- Architecture, modules, flows, APIs
- Jobs, schemas, conventions
- Decisions and historical rationale
- Risks, open gaps, recurring bugs
- Implementation patterns, ownership

## The Mutation Loop

```
Current Brain (version N)
   +
New Commit / PR
   +
Related Sessions (digested moments, narratives)
   +
Static Code Context (diff, AST, file structure)
   ↓
Synthesis Pipeline
   ↓
Brain Mutation Proposal
   ↓
Validation / Review
   ↓
Next Brain (version N+1)
```

Every PR/session produces a **proposed brain mutation** — not "update docs," not "summarize code."

### The synthesis input

```
old repo brain
+ new code diff
+ related session history
+ static repo context
= proposed next repo brain
```

### The mutation report

Each brain mutation produces a report:

1. What changed in the repo
2. What intent drove the change
3. Which repo insights were updated
4. Which new insights were created
5. Which old insights became stale
6. Which uncertainty/gaps remain
7. Which files/entities support the update
8. Recommended follow-up

## Insight Model

"Insight" is a **codename** for the atomic unit of brain knowledge. The actual shape of an insight is intentionally flexible — different users and teams will care about different things. The brain must support user-defined insight types, not a hardcoded taxonomy.

Examples of what an insight might be, depending on the user's context:
- An architectural decision and its rationale
- A recurring bug pattern and its root cause
- An API contract and its consumers
- A convention that emerged over time
- A risk identified during a session
- A module's ownership and responsibility boundary
- A flow across services
- A gap that nobody has addressed yet

Insights are **categorized** — e.g., `feature`, `architecture`, `convention`, `risk`, `api`, `bug_pattern`. Categories are user-configurable, not hardcoded. The mutation pipeline is agnostic to insight types — users define what matters, the system synthesizes and evolves.

### Knowledge graph with drill-down

The brain is a **knowledge graph**, not a flat list. Insights link to other insights (an architecture decision constrains a feature; a bug pattern relates to a module). Users explore the graph at multiple zoom levels:

```
Category (feature, architecture, risk...)
  → Insight (the knowledge node)
    → Evidence (which mutations created/updated it)
      → Sessions (the conversations that produced the evidence)
        → Moments (specific turning points within sessions)
          → Events (raw normalized conversation events)
```

Users can drill down from any insight to the raw moments and events that back it. The depth they reach depends on what they're doing — a PM stops at insights, a developer goes to moments, a debugger goes to events. The system must support traversal at every level.

## Core Types (design direction)

```typescript
type RepoBrainVersion = {
  id: string;
  repoCommitSha: string;
  parentBrainVersionId?: string;
  createdAt: string;
  insights: RepoInsight[];      // "insight" = codename, user-defined types
  evidence: EvidenceEvent[];
  gaps: KnowledgeGap[];
};

type BrainMutationProposal = {
  baseBrainVersionId: string;
  targetCommitSha: string;
  evidence: {
    sessions: string[];
    commits: string[];
    pullRequests: string[];
    filesChanged: string[];
  };
  createdInsights: RepoInsight[];
  updatedInsights: RepoInsightChange[];
  deprecatedInsights: RepoInsightDeprecation[];
  confidence: number;
  report: string;
};
```

Discuss implementation details with the owner before building. The insight type system and mutation pipeline flexibility are core product decisions.

## What Exists Today

### Session digestion pipeline (working)
- 8 sessions digested across 3 projects (brain: 4, telegram: 2, telegram-tmp: 1) + 1 eval fixture
- Each session produces: moments, transitions, accepted outcomes, abandoned directions, narrative arcs
- Stored in Postgres: `sessions`, `moments`, `chunks`, `narratives`, `transitions`, `normalized_events`

### Dashboard (working, basic)
- Three-panel layout: Features | Sessions+Story | Chat
- Sessions shown as flat rows — no project grouping, not bound to code changes
- Chat works: can ask questions about a session's digest

### What's missing for the brain
- Sessions not linked to git commits/PRs
- No brain versioning, no mutation proposals
- No insight graph — the data is flat session-by-session
- No project grouping in the UI

## Technical Starting Points

### Linking sessions to commits
- CC session logs contain tool calls with `git commit`, `git push`, file writes
- Normalized events preserve these as `tool_input`/`tool_output` events
- A pipeline step could extract commit SHAs from session events

### Static analysis of diffs
- `git diff` gives file-level changes
- AST-level analysis (tree-sitter or TS compiler API) gives function-level changes
- This is **context for synthesis**, not the brain itself

### The synthesis pipeline
- Takes: current brain version + code diff + session digests + static context
- Produces: `BrainMutationProposal` with created/updated/deprecated insights
- This is the core new work — discuss the pipeline design with the owner

## Fixes Made This Session

Bug fixes during the digestion run — already in the codebase:

1. **`src/storage/connection.ts`** — added `closeDb()` to close postgres pool (process hang fix)
2. **`src/cli/digest.ts`** — calls `closeDb()` after pipeline run
3. **`src/llm/prompts/moments.ts`** — made `evidence` field optional with default (Zod crash fix)
4. **`src/llm/client.ts`** — switched to `client.messages.stream()` (10-min timeout fix for large sessions)

## Known Issues

1. **All moments scored "high" confidence** — no discrimination
2. **`chunk.ts` still uses regex** for topic shift detection
3. **Winning organism `{1b, 2f, 3c, 4a}` not wired as default** in orchestrator
4. **No duplicate session prevention** — can re-digest the same JSONL file
