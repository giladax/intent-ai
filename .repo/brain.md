# intent-ai — Brain

> This file is the entry point to the project's knowledge graph.
> Each spec below is a concept in the codebase with accumulated insights from development sessions.
> Use the file index at the bottom to find which spec covers any source file.

## Architecture & Design

- [Architecture & Design](topics/architecture-design.md) — This document describes the high-level architecture and design principles of the codebase. It ser... (4 files)

## Brain Versioning

- [Brain Versioning](topics/brain-versioning.md) — Brain Versioning is the mechanism by which the Repo Brain accumulates and tracks knowledge over t... (9 files)
  - [Brain Insight Categories](topics/brain-insight-categories.md) — Brain Insight Categories are the typed classification system applied to every insight stored in t... (1 files)
  - [Brain Synthesis Quality](topics/brain-synthesis-quality.md) — Brain Synthesis Quality encompasses the mechanisms, gates, and evaluation strategies that ensure ... (2 files)
  - [Static Repo Index](topics/static-repo-index.md) — The Static Repo Index is the committed, agent-readable layer of the Repo Brain — a set of markdow... (3 files)

## Dashboard Architecture

- [Dashboard Architecture](topics/dashboard-architecture.md) — The dashboard is a single-page React application built with shadcn/ui that exposes two top-level ... (11 files)

## Pipeline Orchestration

- [Pipeline Orchestration](topics/pipeline-orchestration.md) — The pipeline orchestrator is the central coordinator that transforms raw Claude Code conversation... (14 files)
  - [Database Infrastructure](topics/database-infrastructure.md) — The database infrastructure layer provides persistent storage for the pipeline orchestrator using... (3 files)
  - [Moment Detection & Evaluation](topics/moment-detection-evaluation.md) — Moment Detection & Evaluation is the semantic core of the pipeline — the stage responsible for id... (8 files)

## File Index

> Find which spec covers a source file. Path shows the spec hierarchy.

| File | Spec |
|------|------|
| `.repo/brain.md` | Brain Versioning > Static Repo Index |
| `.repo/topics/moment-detection.md` | Brain Versioning > Static Repo Index |
| `/Users/giladkoch/.claude/projects/-Users-giladkoch/memory/MEMORY.md` | Architecture & Design |
| `/Users/giladkoch/.claude/projects/-Users-giladkoch/memory/user_prefers_typescript.md` | Architecture & Design |
| `docs/superpowers/specs/2026-05-21-execution-memory-design.md` | Pipeline Orchestration > Moment Detection & Evaluation |
| `docs/superpowers/specs/2026-05-21-execution-memory-design.md` | Pipeline Orchestration > Moment Detection & Evaluation |
| `drizzle.config.ts` | Pipeline Orchestration > Database Infrastructure |
| `src/adapters/types.ts` | Brain Versioning |
| `src/brain/generate-markdown.ts` | Brain Versioning > Static Repo Index |
| `src/cli/digest.ts` | Pipeline Orchestration > Moment Detection & Evaluation |
| `src/cli/index.ts` | Brain Versioning |
| `src/cli/infra.ts` | Pipeline Orchestration > Database Infrastructure |
| `src/db/schema.ts` | Pipeline Orchestration > Moment Detection & Evaluation |
| `src/llm/client.ts` | Pipeline Orchestration |
| `src/llm/prompts/brain-synthesis.ts` | Brain Versioning |
| `src/pipeline/brain-synthesis.ts` | Pipeline Orchestration > Moment Detection & Evaluation |
| `src/pipeline/classify-exchanges.ts` | Pipeline Orchestration > Moment Detection & Evaluation |
| `src/pipeline/index.ts` | Pipeline Orchestration > Moment Detection & Evaluation |
| `src/pipeline/moments.ts` | Pipeline Orchestration > Moment Detection & Evaluation |
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
