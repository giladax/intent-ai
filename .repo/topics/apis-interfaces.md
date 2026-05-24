# APIs & Interfaces

> Children: [MCP Server & Graph Navigation](mcp-server-graph-navigation.md)

The APIs & Interfaces layer defines the external and internal contracts through which the system exposes its capabilities to consumers — whether those are human developers, AI agents, or other services. This layer sits above the core domain logic and below any transport-specific concerns, ensuring that the system's functionality is accessible in a consistent, versioned, and well-documented manner. The MCP Server & Graph Navigation subsystem (covered in its own child spec) represents one concrete implementation of these interfaces, handling graph traversal and tool exposure for AI agent consumers. Because no knowledge fragments were provided for this spec, the current document represents a structural placeholder that should be evolved as implementation details are captured.

## structure

- The APIs & Interfaces layer acts as the boundary between internal domain logic and external consumers; the MCP Server & Graph Navigation child spec covers one concrete surface of this boundary and should not be duplicated here.

## risk

- With no knowledge fragments assigned to this spec, the current interface contracts are underdocumented — a new developer cannot determine versioning strategy, authentication requirements, or error-response shapes without reading source code directly.

## interface

- The system exposes at least one machine-readable interface (the MCP server) intended for AI agent consumption; additional REST, GraphQL, or RPC surfaces should be catalogued here as they are introduced.

## Files

- _from [MCP Server & Graph Navigation](mcp-server-graph-navigation.md):_
  - `.repo/brain.md`
  - `src/brain/cards.ts`
  - `src/brain/generate-markdown.ts`
  - `src/mcp/server.ts`
  - `tests/mcp/server.test.ts`

## Sessions

- May 25: The developer set out to implement insight deduplication using Eval-Driven Development, requiring... (7 moments)
