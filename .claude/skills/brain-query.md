---
name: brain-query
description: Query the intent-ai brain knowledge graph for codebase context. Use when you need to understand how something works, find relevant files, get step-by-step recipes, or understand why something was built a certain way. Simulates MCP brain tools via REST API.
---

# Brain Query Skill

Query the project's accumulated knowledge graph for codebase navigation, patterns, skills, and intent.

## Prerequisites

The web server must be running: `npx tsx src/cli/index.ts web --port 3456`

If the server isn't running, start it in the background before proceeding.

## Available Queries

You have 5 query tools available via the REST API at `http://localhost:3456`:

### 1. Search Brain (free-text)
Find topics, insights, and patterns matching a query.

```bash
curl -s "http://localhost:3456/api/brain/search?q=QUERY&repoId=REPO_ID" | head -100
```

### 2. Get Topic (full details)
Get complete topic with insights, patterns, skills, and files.

```bash
curl -s "http://localhost:3456/api/brain/topics/TOPIC_ID/full" | head -100
```

### 3. Get Skill (step-by-step recipe)
Get a specific skill/recipe for a common task.

```bash
curl -s "http://localhost:3456/api/brain/skills/SKILL_ID" | head -100
```

### 4. Get Files Context
Get brain context for files you're about to work on.

```bash
curl -s -X POST http://localhost:3456/api/brain/files-context \
  -H "Content-Type: application/json" \
  -d '{"files":["src/pipeline/orchestrator.ts","src/adapters/types.ts"],"repoId":"REPO_ID"}' | head -100
```

### 5. Ask Intent
Ask why something was built a certain way. Returns session moments and decisions.

```bash
curl -s -X POST http://localhost:3456/api/brain/ask-intent \
  -H "Content-Type: application/json" \
  -d '{"query":"why was the two-pass moment detection chosen","repoId":"REPO_ID"}' | head -100
```

## How to Use

When you need codebase context, dispatch a subagent to query the brain:

```
Agent tool:
  description: "Query brain for [topic]"
  prompt: |
    You are a brain query agent. Your job is to query the intent-ai brain REST API
    and return structured results.

    Query to answer: [THE QUESTION]

    Steps:
    1. First, find the repo ID:
       curl -s http://localhost:3456/api/projects | jq '.[0].id'

    2. Search the brain:
       curl -s "http://localhost:3456/api/brain/search?q=[SEARCH_TERMS]&repoId=[REPO_ID]"

    3. If you find relevant topics, get full details:
       curl -s "http://localhost:3456/api/brain/topics/[TOPIC_ID]/full"

    4. If the question is about files, use files-context:
       curl -s -X POST http://localhost:3456/api/brain/files-context \
         -H "Content-Type: application/json" \
         -d '{"files":[FILE_PATHS],"repoId":"[REPO_ID]"}'

    5. If the question is "why was X built this way", use ask-intent:
       curl -s -X POST http://localhost:3456/api/brain/ask-intent \
         -H "Content-Type: application/json" \
         -d '{"query":"[QUESTION]","repoId":"[REPO_ID]"}'

    Return a concise summary of what the brain says, including:
    - Relevant topic names and summaries
    - Key insights (especially navigation, pitfall, constraint)
    - Any patterns (requests agents keep making, common struggles)
    - Any skills/recipes available
    - File references
```

## When to Use This Skill

- **Before starting work on unfamiliar code**: Query `files-context` for the files you'll touch
- **When exploring the codebase**: Use `search` to find relevant knowledge areas
- **When stuck**: Check if there are `struggle` patterns or `pitfall` insights for your area
- **When following a workflow**: Look for approved `skills` with step-by-step recipes
- **When you need to understand history**: Use `ask-intent` for decision rationale

## Fallback: Offline Mode

If the web server isn't running, the brain is also available as markdown files:
- `.repo/brain.md` — topic index with hierarchy
- `.repo/topics/*.md` — per-topic knowledge with insights, patterns, skills
- Use the `intent mcp` command for MCP-native access (reads .repo/ files directly)
