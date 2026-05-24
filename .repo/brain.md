# intent-ai — Brain

> This file is the entry point to the project's knowledge graph.
> Each spec below is a concept in the codebase with accumulated insights from development sessions.
> Use the file index at the bottom to find which spec covers any source file.

## Brain Versioning

- [Brain Versioning](topics/brain-versioning.md) — Brain Versioning is the mechanism by which the Repo Brain accumulates and tracks knowledge over t... (8 files)
  - [Brain Insight Categories](topics/brain-insight-categories.md) — Brain Insight Categories are the typed classification system applied to every insight stored in t... (1 files)

## Dashboard Architecture

- [Dashboard Architecture](topics/dashboard-architecture.md) — The dashboard is a single-page React application built with shadcn/ui that exposes two top-level ... (11 files)

## Design Principles

- [Design Principles](topics/design-principles.md) — The v2 system is built on two foundational design principles that define its identity and set har...

## Moment Detection

- [Moment Detection](topics/moment-detection.md) — Moment Detection is the core intelligence layer of the Intent AI pipeline — the subsystem respons... (4 files)

## Pipeline Orchestration

- [Pipeline Orchestration](topics/pipeline-orchestration.md) — The pipeline orchestrator is the central coordinator that transforms raw Claude Code conversation... (10 files)
  - [Database Infrastructure](topics/database-infrastructure.md) — The database infrastructure layer provides persistent storage for the pipeline orchestrator using... (3 files)
  - [Evaluation Framework](topics/evaluation-framework.md) — The Evaluation Framework is a first-class architectural component of the intent-ai pipeline, not ... (1 files)

## Tech Stack

- [Tech Stack](topics/tech-stack.md) — intent-ai is a TypeScript monolith CLI that runs as a single process containing all subsystems: a... (4 files)

## File Index

> Find which spec covers a source file. Path shows the spec hierarchy.

| File | Spec |
|------|------|
| `.repo/brain.md` | Brain Versioning |
| `.repo/topics/moment-detection.md` | Brain Versioning |
| `/Users/giladkoch/.claude/projects/-Users-giladkoch/memory/MEMORY.md` | Tech Stack |
| `/Users/giladkoch/.claude/projects/-Users-giladkoch/memory/user_prefers_typescript.md` | Tech Stack |
| `docs/superpowers/specs/2026-05-21-execution-memory-design.md` | Tech Stack |
| `docs/superpowers/specs/2026-05-21-execution-memory-design.md` | Tech Stack |
| `drizzle.config.ts` | Pipeline Orchestration > Database Infrastructure |
| `src/adapters/types.ts` | Brain Versioning |
| `src/brain/generate-markdown.ts` | Brain Versioning |
| `src/cli/digest.ts` | Pipeline Orchestration > Database Infrastructure |
| `src/cli/index.ts` | Brain Versioning |
| `src/cli/infra.ts` | Pipeline Orchestration > Database Infrastructure |
| `src/llm/client.ts` | Pipeline Orchestration |
| `src/llm/prompts/brain-synthesis.ts` | Brain Versioning |
| `src/pipeline/brain-synthesis.ts` | Moment Detection |
| `src/pipeline/classify-exchanges.ts` | Pipeline Orchestration |
| `src/pipeline/moments.ts` | Pipeline Orchestration |
| `src/pipeline/orchestrator.ts` | Pipeline Orchestration |
| `src/storage/connection.ts` | Pipeline Orchestration |
| `src/storage/schema.ts` | Pipeline Orchestration |
| `src/web/server.ts` | Dashboard Architecture |
| `src/web/ui/src/api.ts` | Dashboard Architecture |
| `src/web/ui/src/App.tsx` | Dashboard Architecture |
| `src/web/ui/src/components/ChatPanel.tsx` | Dashboard Architecture |
| `src/web/ui/src/components/Header.tsx` | Dashboard Architecture |
| `src/web/ui/src/components/SessionList.tsx` | Dashboard Architecture |
| `src/web/ui/src/components/SessionPanel.tsx` | Dashboard Architecture |
| `src/web/ui/src/components/TopicDetail.tsx` | Dashboard Architecture |
| `src/web/ui/src/components/TopicList.tsx` | Dashboard Architecture |
| `src/web/ui/src/index.css` | Dashboard Architecture |
| `src/web/ui/src/types.ts` | Dashboard Architecture |
