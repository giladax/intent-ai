# intent-ai Brain

## API Endpoints

- [API Endpoints](topics/api-endpoints.md) — The API layer lives in src/web/server.ts and serves the Brain/Sessions dashbo... (3 sessions, 6 insights)

## Brain Markdown Generation

- [Brain Markdown Generation](topics/brain-markdown-generation.md) — Brain Markdown Generation is the subsystem responsible for exporting the Repo... (3 sessions, 7 insights)

## Brain Versioning

- [Brain Versioning](topics/brain-versioning.md) — Brain Versioning is the mechanism by which the Repo Brain accumulates and tra... (3 sessions, 6 insights)

## Dashboard Architecture

- [Dashboard Architecture](topics/dashboard-architecture.md) — The dashboard is a single-page React application built with shadcn/ui that ex... (3 sessions, 7 insights)

## Design Principles

- [Design Principles](topics/design-principles.md) — The v2 system is built on two foundational design principles that distinguish... (3 sessions, 3 insights)

## Moment Detection

- [Moment Detection](topics/moment-detection.md) — Moment Detection is the core intelligence layer of the Intent AI pipeline — t... (3 sessions, 6 insights)

## Pipeline Orchestration

- [Pipeline Orchestration](topics/pipeline-orchestration.md) — The pipeline orchestrator is the central coordinator that transforms raw Clau... (3 sessions, 8 insights)

## Tech Stack

- [Tech Stack](topics/tech-stack.md) — intent-ai is a TypeScript monolith CLI that runs as a single process containi... (3 sessions, 6 insights)

## File Map

| File | Topics |
|------|--------|
| .repo/brain.md | Brain Markdown Generation, Brain Versioning |
| .repo/topics/moment-detection.md | Brain Markdown Generation, Brain Versioning |
| /Users/giladkoch/.claude/projects/-Users-giladkoch/memory/user_prefers_typescript.md | Tech Stack |
| docs/superpowers/specs/2026-05-21-execution-memory-design.md | Moment Detection, Tech Stack |
| src/adapters/types.ts | Brain Markdown Generation, Brain Versioning |
| src/brain/generate-markdown.ts | Brain Markdown Generation, Brain Versioning |
| src/cli/digest.ts | Pipeline Orchestration |
| src/cli/index.ts | Brain Markdown Generation, Brain Versioning |
| src/llm/client.ts | Pipeline Orchestration |
| src/llm/prompts/brain-synthesis.ts | Brain Markdown Generation, Brain Versioning |
| src/pipeline/brain-synthesis.ts | Brain Markdown Generation, Brain Versioning |
| src/pipeline/moments.ts | Pipeline Orchestration |
| src/pipeline/orchestrator.ts | Pipeline Orchestration |
| src/storage/connection.ts | Pipeline Orchestration |
| src/storage/schema.ts | Brain Markdown Generation, Brain Versioning, Pipeline Orchestration |
| src/web/server.ts | API Endpoints, Dashboard Architecture |
| src/web/ui/src/api.ts | API Endpoints, Dashboard Architecture |
| src/web/ui/src/App.tsx | Dashboard Architecture |
| src/web/ui/src/components/ChatPanel.tsx | Dashboard Architecture |
| src/web/ui/src/components/Header.tsx | Dashboard Architecture |
| src/web/ui/src/components/SessionList.tsx | Dashboard Architecture |
| src/web/ui/src/components/SessionPanel.tsx | Dashboard Architecture |
| src/web/ui/src/components/TopicDetail.tsx | Dashboard Architecture |
| src/web/ui/src/components/TopicList.tsx | Dashboard Architecture |
| src/web/ui/src/index.css | Dashboard Architecture |
| src/web/ui/src/types.ts | API Endpoints, Dashboard Architecture |
