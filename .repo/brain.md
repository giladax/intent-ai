# intent-ai Brain

## Topics

- [digestion pipeline](topics/digestion-pipeline.md) — The intent-ai digestion pipeline is a sequential, single-process pipeline tri... (2 sessions, 12 insights)
- [dashboard redesign](topics/dashboard-redesign.md) — The dashboard was redesigned from a single-view layout to a Brain/Sessions ta... (1 sessions, 6 insights)
- [data model and schema](topics/data-model-and-schema.md) — The intent-ai data model centers on the `SessionNarrative` interface stored i... (1 sessions, 3 insights)
- [moment detection system](topics/moment-detection-system.md) — Moment detection is the crown jewel of intent-ai v1 — the component that must... (1 sessions, 5 insights)
- [Repo Brain pipeline](topics/repo-brain-pipeline.md) — The Repo Brain is a versioned knowledge graph synthesized from session digest... (1 sessions, 9 insights)
- [tech stack and architecture decisions](topics/tech-stack-and-architecture-decisions.md) — intent-ai is a greenfield TypeScript monolith CLI project using PostgreSQL wi... (1 sessions, 4 insights)

## File Map

| File | Topics |
|------|--------|
| .repo/brain.md | Repo Brain pipeline |
| .repo/topics/moment-detection.md | Repo Brain pipeline |
| /Users/giladkoch/.claude/projects/-Users-giladkoch/memory/MEMORY.md | tech stack and architecture decisions |
| /Users/giladkoch/.claude/projects/-Users-giladkoch/memory/user_prefers_typescript.md | tech stack and architecture decisions |
| docs/superpowers/specs/2026-05-21-execution-memory-design.md | digestion pipeline, data model and schema, moment detection system, tech stack and architecture decisions |
| docs/plans/2026-05-23-repo-brain.md | Repo Brain pipeline |
| docs/superpowers/specs/2026-05-23-repo-brain-design.md | Repo Brain pipeline |
| docs/superpowers/specs/2026-05-24-dashboard-redesign.md | dashboard redesign |
| src/adapters/types.ts | Repo Brain pipeline |
| src/brain/generate-markdown.ts | Repo Brain pipeline |
| src/cli/digest.ts | digestion pipeline |
| src/cli/index.ts | Repo Brain pipeline |
| src/llm/client.ts | digestion pipeline |
| src/llm/prompts/brain-synthesis.ts | Repo Brain pipeline |
| src/pipeline/brain-synthesis.ts | Repo Brain pipeline |
| src/pipeline/classify-exchanges.ts | digestion pipeline |
| src/pipeline/moments.ts | digestion pipeline |
| src/pipeline/orchestrator.ts | digestion pipeline |
| src/storage/connection.ts | digestion pipeline |
| src/storage/schema.ts | Repo Brain pipeline |
| src/web/server.ts | dashboard redesign |
| src/web/ui/src/api.ts | dashboard redesign |
| src/web/ui/src/App.tsx | dashboard redesign |
| src/web/ui/src/components/ChatPanel.tsx | dashboard redesign |
| src/web/ui/src/components/Header.tsx | dashboard redesign |
| src/web/ui/src/components/SessionList.tsx | dashboard redesign |
| src/web/ui/src/components/SessionPanel.tsx | dashboard redesign |
| src/web/ui/src/components/TopicDetail.tsx | dashboard redesign |
| src/web/ui/src/components/TopicList.tsx | dashboard redesign |
| src/web/ui/src/index.css | dashboard redesign |
| src/web/ui/src/types.ts | dashboard redesign |
