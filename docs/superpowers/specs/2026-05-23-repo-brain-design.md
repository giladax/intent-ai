# Repo Brain — Design Spec

## What

A per-repo knowledge graph of topics, insights, and file relationships — extracted from digested sessions, stored in Postgres, committed as markdown, and surfaced in the dashboard.

## Data Model

```typescript
type Topic = {
  id: string;
  repoId: string;
  name: string;
  summary: string;
  insights: Insight[];
  fileRefs: FileRef[];
  sessionRefs: string[];
  relatedTopics: { topicId: string; relationship: string }[];
};

type Insight = {
  id: string;
  topicId: string;
  category: "structure" | "decision" | "constraint" | "behavior" | "risk" | "interface";
  statement: string;
  evidence: { sessionId: string; momentId?: string }[];
  confidence: number;
  status: "active" | "stale" | "deprecated";
};

type FileRef = { path: string; role: string };

type BrainVersion = {
  id: string;
  repoId: string;
  commitSha: string;
  parentVersionId?: string;
  createdAt: string;
};

type BrainMutation = {
  id: string;
  baseVersionId: string;
  targetCommitSha: string;
  createdInsights: Insight[];
  updatedInsights: { insightId: string; before: string; after: string }[];
  deprecatedInsightIds: string[];
  newTopics: Topic[];
  report: string;
};
```

## Insight Categories

| Category | Agent behavior |
|----------|---------------|
| `structure` | Build mental model of components |
| `decision` | Understand why, don't undo |
| `constraint` | Hard rule during code generation |
| `behavior` | Understand execution sequences |
| `risk` | Proceed with caution |
| `interface` | Honor the contract |

## Pipeline

```
Session digest (from DB: narrative + moments + outcomes)
  + files touched (from normalized events)
  ↓
Topic Synthesis (Sonnet) — "What reusable knowledge does this session contribute?"
  ↓
Topics + Insights + FileRefs + EvidenceRefs
  ↓
Store to Postgres → Generate .repo/ markdown
```

Multi-session: synthesis receives existing brain state, outputs updates/creates/deprecates.

## Markdown Output

`.repo/brain.md` — root index with topic list + file map.
`.repo/topics/<name>.md` — per-topic: summary, insights by category, files, evidence sessions.
`CLAUDE.md` references `.repo/brain.md` in its reference table.

## Dashboard

Two tabs: **Brain** (shared knowledge) and **Sessions** (private execution memory).

Brain tab: three panels — Topics (with session/moment counts) | Topic Detail (insights, files, evidence) | Chat.
Sessions tab: current view, grouped by repo, with topic badges linking back to brain.

Topic list shows activity weight: session count, moment count, update count.
Click topic → see insights + navigate to evidence sessions.
Filter by category or file (bidirectional: topic→files, file→topics).

## EDD Approach

1. Start with session 1 → run synthesis → human reviews output
2. Adjust prompt/schema → re-run → converge on single-session quality
3. Add session 2 → test merge behavior (update vs create)
4. Converge on multi-session → formalize LLM-as-judge criteria
5. Run remaining sessions

## Scope

- Single repo at a time (repo selector in UI)
- Bootstrap from existing 8 digested sessions in Postgres
- No static code analysis yet (later)
- No CI/GitHub integration yet (CLI only, structured for reuse)
- Mutation versioning comes after vertical slice works
