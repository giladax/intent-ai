# Intent-AI Demo Script

## Prerequisites

- Docker running (`npx tsx src/cli/index.ts up`)
- Brain exported (`npx tsx src/cli/index.ts brain-export`)
- MCP configured (`.mcp.json` with intent-brain server)

## Act 1: Without Memory (2 min)

Open Claude Code on this repo WITHOUT MCP brain. Ask:

> "I need to add a new pipeline node that detects code quality issues. How do I do that?"

Let the agent explore and struggle — it will miss:
- Two-model strategy (Haiku for cheap, Sonnet for expensive)
- `client.messages.stream()` requirement (not `.create()`)
- Three mocks needed in orchestrator tests
- Sequential digest constraint
- Event emission wiring

Kill after 30-60 seconds of exploration.

## Act 2: What the System Sees (3 min)

```bash
# Events from real coding sessions
npx tsx src/cli/index.ts events --limit 10

# System's own observations across sessions
npx tsx src/cli/index.ts events --category observation

# The knowledge tree
cat .repo/brain.md | head -35

# What it knows about the pipeline (the good stuff)
head -60 .repo/topics/core-pipeline-brain.md
```

Key message: "This knowledge came from watching agents work, not from documentation."

## Act 3: With Memory (3 min)

Open Claude Code WITH MCP brain configured. Same question:

> "I need to add a new pipeline node that detects code quality issues. How do I do that?"

Agent queries brain_file_context, gets constraints upfront, answers correctly first try.

## The Punchline

"Every AI coding session generates knowledge that today evaporates. We capture it, synthesize it, and feed it back. The agent that worked yesterday makes today's agent smarter."

## Future Vision

MCP is the integration surface. Today: Claude Code. Tomorrow: Codex, Copilot, Jira, Slack. The brain becomes an org-level knowledge layer that any tool can query.
