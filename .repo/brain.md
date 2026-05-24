# intent-ai — Brain

> This file is the entry point to the project's knowledge graph.
> Each spec below is a concept in the codebase with accumulated insights from development sessions.
> Use the file index at the bottom to find which spec covers any source file.

## APIs & Interfaces

- [APIs & Interfaces](topics/apis-interfaces.md) — The APIs & Interfaces layer defines the external and internal contracts through which the system ... (5 files)
  - [MCP Server & Graph Navigation](topics/mcp-server-graph-navigation.md) — The MCP server is a filesystem-based, graph-aware navigation system that exposes the .repo/ knowl... (5 files)

## Architecture & Design

- [Architecture & Design](topics/architecture-design.md) — This document describes the high-level architecture and design principles of the codebase. It ser... (7 files)
  - [Database Infrastructure](topics/database-infrastructure.md) — The database infrastructure layer provides persistent storage for the pipeline orchestrator using... (3 files)

## Core Pipeline & Brain

- [Core Pipeline & Brain](topics/core-pipeline-brain.md) — The Core Pipeline & Brain is the central processing system responsible for transforming raw codeb... (19 files)
  - [Static Repo Index](topics/static-repo-index.md) — The Static Repo Index is the committed, agent-readable layer of the Repo Brain — a set of markdow... (4 files)

## Dashboard & UI

- [Dashboard & UI](topics/dashboard-ui.md) — The Dashboard & UI layer is the primary visual interface through which users interact with the sy... (11 files)

## File Index

> Find which spec covers a source file. Path shows the spec hierarchy.

| File | Spec |
|------|------|
| `.repo/` | Core Pipeline & Brain > Static Repo Index |
| `.repo/brain.md` | Core Pipeline & Brain > Static Repo Index |
| `.repo/topics/moment-detection.md` | Core Pipeline & Brain > Static Repo Index |
| `/Users/giladkoch/.claude/projects/-Users-giladkoch/memory/MEMORY.md` | Architecture & Design |
| `/Users/giladkoch/.claude/projects/-Users-giladkoch/memory/user_prefers_typescript.md` | Architecture & Design |
| `docs/superpowers/specs/2026-05-21-execution-memory-design.md` | Core Pipeline & Brain |
| `docs/superpowers/specs/2026-05-21-execution-memory-design.md` | Core Pipeline & Brain |
| `drizzle.config.ts` | Architecture & Design > Database Infrastructure |
| `src/adapters/types.ts` | Core Pipeline & Brain |
| `src/brain/cards.ts` | APIs & Interfaces > MCP Server & Graph Navigation |
| `src/brain/generate-markdown.ts` | Core Pipeline & Brain > Static Repo Index |
| `src/cli/digest.ts` | Core Pipeline & Brain |
| `src/cli/index.ts` | Core Pipeline & Brain |
| `src/cli/infra.ts` | Architecture & Design > Database Infrastructure |
| `src/db/schema.ts` | Core Pipeline & Brain |
| `src/llm/client.ts` | Core Pipeline & Brain |
| `src/llm/prompts/brain-synthesis.ts` | Core Pipeline & Brain |
| `src/mcp/server.ts` | APIs & Interfaces > MCP Server & Graph Navigation |
| `src/pipeline/brain-synthesis.ts` | Core Pipeline & Brain |
| `src/pipeline/classify-exchanges.ts` | Core Pipeline & Brain |
| `src/pipeline/index.ts` | Core Pipeline & Brain |
| `src/pipeline/moments.ts` | Core Pipeline & Brain |
| `src/pipeline/orchestrator.ts` | Core Pipeline & Brain |
| `src/storage/connection.ts` | Core Pipeline & Brain |
| `src/storage/schema.ts` | Core Pipeline & Brain |
| `src/web/server.ts` | Dashboard & UI |
| `src/web/ui/src/api.ts` | Dashboard & UI |
| `src/web/ui/src/App.tsx` | Dashboard & UI |
| `src/web/ui/src/components/ChatPanel.tsx` | Dashboard & UI |
| `src/web/ui/src/components/Header.tsx` | Dashboard & UI |
| `src/web/ui/src/components/SessionList.tsx` | Dashboard & UI |
| `src/web/ui/src/components/SessionPanel.tsx` | Dashboard & UI |
| `src/web/ui/src/components/TopicDetail.tsx` | Dashboard & UI |
| `src/web/ui/src/components/TopicList.tsx` | Dashboard & UI |
| `src/web/ui/src/index.css` | Dashboard & UI |
| `src/web/ui/src/types.ts` | Dashboard & UI |
| `tests/mcp/server.test.ts` | APIs & Interfaces > MCP Server & Graph Navigation |
