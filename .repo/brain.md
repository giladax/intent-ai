# intent-ai Brain

## Brain Versioning

- [Brain Versioning](topics/brain-versioning.md) — Brain Versioning is the mechanism by which the Repo Brain accumulates and tra...
  - [Brain Insight Categories](topics/brain-insight-categories.md) — Brain Insight Categories are the typed classification system applied to every...

## Dashboard Architecture

- [Dashboard Architecture](topics/dashboard-architecture.md) — The dashboard is a single-page React application built with shadcn/ui that ex...

## Design Principles

- [Design Principles](topics/design-principles.md) — The v2 system is built on two foundational design principles that define its ...

## Pipeline Orchestration

- [Pipeline Orchestration](topics/pipeline-orchestration.md) — The pipeline orchestrator is the central coordinator that transforms raw Clau...
  - [Evaluation Framework](topics/evaluation-framework.md) — The Evaluation Framework is a first-class architectural component of the inte...
  - [Moment Detection](topics/moment-detection.md) — Moment Detection is the core intelligence layer of the Intent AI pipeline — t...

## Tech Stack

- [Tech Stack](topics/tech-stack.md) — intent-ai is a TypeScript monolith CLI that runs as a single process containi...
  - [Database Infrastructure](topics/database-infrastructure.md) — The database infrastructure layer provides persistent storage for the pipelin...

## File Map

| File | Topics |
|------|--------|
| .repo/brain.md | Brain Versioning |
| .repo/topics/moment-detection.md | Brain Versioning |
| /Users/giladkoch/.claude/projects/-Users-giladkoch/memory/MEMORY.md | Tech Stack |
| /Users/giladkoch/.claude/projects/-Users-giladkoch/memory/user_prefers_typescript.md | Tech Stack |
| docs/superpowers/specs/2026-05-21-execution-memory-design.md | Moment Detection, Tech Stack |
| docs/superpowers/specs/2026-05-21-execution-memory-design.md | Evaluation Framework, Moment Detection, Pipeline Orchestration, Tech Stack |
| drizzle.config.ts | Database Infrastructure |
| src/adapters/types.ts | Brain Versioning |
| src/brain/generate-markdown.ts | Brain Versioning |
| src/cli/digest.ts | Database Infrastructure, Pipeline Orchestration |
| src/cli/index.ts | Brain Versioning |
| src/cli/infra.ts | Database Infrastructure |
| src/llm/client.ts | Pipeline Orchestration |
| src/llm/prompts/brain-synthesis.ts | Brain Versioning |
| src/pipeline/brain-synthesis.ts | Brain Insight Categories, Brain Versioning, Moment Detection |
| src/pipeline/classify-exchanges.ts | Moment Detection, Pipeline Orchestration |
| src/pipeline/moments.ts | Pipeline Orchestration |
| src/pipeline/orchestrator.ts | Pipeline Orchestration |
| src/storage/connection.ts | Pipeline Orchestration |
| src/storage/schema.ts | Brain Versioning, Pipeline Orchestration |
| src/web/server.ts | Dashboard Architecture |
| src/web/ui/src/api.ts | Dashboard Architecture |
| src/web/ui/src/App.tsx | Dashboard Architecture |
| src/web/ui/src/components/ChatPanel.tsx | Dashboard Architecture |
| src/web/ui/src/components/Header.tsx | Dashboard Architecture |
| src/web/ui/src/components/SessionList.tsx | Dashboard Architecture |
| src/web/ui/src/components/SessionPanel.tsx | Dashboard Architecture |
| src/web/ui/src/components/TopicDetail.tsx | Dashboard Architecture |
| src/web/ui/src/components/TopicList.tsx | Dashboard Architecture |
| src/web/ui/src/index.css | Dashboard Architecture |
| src/web/ui/src/types.ts | Dashboard Architecture |
