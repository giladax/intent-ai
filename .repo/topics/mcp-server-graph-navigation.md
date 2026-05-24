# MCP Server & Graph Navigation

> Parent: [APIs & Interfaces](apis-interfaces.md)

The MCP server is a filesystem-based, graph-aware navigation system that exposes the .repo/ knowledge graph to LLM agents through exactly 5 tools: brain_overview, brain_search, brain_get, brain_traverse, and brain_file_context. It was redesigned from a simple search tool after discovering that the knowledge graph has rich multi-dimensional traversal dimensions (Sessions↔Topics↔Files, Insights↔Evidence↔Moments, TopicRelations cross-links) that a flat search index cannot adequately expose. The server reads .repo/ markdown files at runtime with no Postgres dependency, making it branch-portable and dependency-free — parent/child graph topology is encoded directly in markdown links, enabling full graph traversal from the filesystem alone. The universal navigation atom is the 'card': every node at every level of the tree returns a card with overview, children list, and context. The intended agent navigation pattern is overview-first: brain_overview returns ~32 root specs at ~1650 tokens (small enough to fit in full context), the agent picks an area, then drills in via brain_get or brain_traverse. brain_search is a secondary rather than primary entry point.

## structure

- The MCP server exposes exactly 5 tools — brain_overview, brain_search, brain_get, brain_traverse, and brain_file_context — each serving a distinct role in multi-dimensional graph navigation, all returning cards as the universal navigation atom.

## decision

- The MCP server is filesystem-based (reads .repo/ markdown at runtime) with no Postgres dependency — this is a deliberate architectural choice for branch portability and zero infrastructure requirements.

## risk

- The fuzzyScore algorithm used in brain_search has opaque scoring behavior — test expectations required two fix iterations to match actual token-based scoring. Treat fuzzyScore behavior as non-obvious and validate against real output before writing assertions.

## Files

- `.repo/brain.md`
- `src/brain/cards.ts`
- `src/brain/generate-markdown.ts`
- `src/mcp/server.ts`
- `tests/mcp/server.test.ts`

## Sessions

- May 25: The developer set out to implement insight deduplication using Eval-Driven Development, requiring... (7 moments)
- May 24: The session started with a plan to build a basic MCP server for .repo/ files while delegating ded... (22 moments)
- May 24: The session set out to build a minimal MCP server for the repo brain, but pivoted twice — first f... (21 moments)
