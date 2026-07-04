import { describe, it, expect } from "vitest";
import { makeDigestTools } from "../../src/agents/tools/digests.js";
import { makeGitTools } from "../../src/agents/tools/git.js";

// ── makeDigestTools: schema-level checks ─────────────────────────────────────
// These tests do not connect to the database. They verify that each tool:
//   - exists with the correct name
//   - has a non-empty description
//   - has a well-formed Zod schema (parse succeeds on valid input, rejects wrong types)

describe("makeDigestTools", () => {
  const tools = makeDigestTools();
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

  it("returns exactly 3 tools: search_events, get_session_digest, list_sessions", () => {
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["get_session_digest", "list_sessions", "search_events"].sort(),
    );
  });

  describe("search_events", () => {
    const tool = byName["search_events"];

    it("has a non-empty description", () => {
      expect(tool.description.trim().length).toBeGreaterThan(20);
    });

    it("schema accepts an empty object (all fields optional)", () => {
      expect(() => tool.schema.parse({})).not.toThrow();
    });

    it("schema accepts all supported filter fields", () => {
      expect(() =>
        tool.schema.parse({
          categoryPrefix: "session",
          tags: ["digest"],
          actor: "pipeline",
          sessionId: "abc-123",
          repo: "intent-ai",
          branch: "main",
          since: "2026-07-01T00:00:00Z",
          until: "2026-07-04T23:59:59Z",
        }),
      ).not.toThrow();
    });

    it("schema rejects invalid tags type (string instead of array)", () => {
      expect(() => tool.schema.parse({ tags: "not-an-array" })).toThrow();
    });
  });

  describe("get_session_digest", () => {
    const tool = byName["get_session_digest"];

    it("has a non-empty description", () => {
      expect(tool.description.trim().length).toBeGreaterThan(20);
    });

    it("schema accepts a valid session_id string", () => {
      expect(() =>
        tool.schema.parse({ session_id: "550e8400-e29b-41d4-a716-446655440000" }),
      ).not.toThrow();
    });

    it("schema rejects missing session_id", () => {
      expect(() => tool.schema.parse({})).toThrow();
    });
  });

  describe("list_sessions", () => {
    const tool = byName["list_sessions"];

    it("has a non-empty description", () => {
      expect(tool.description.trim().length).toBeGreaterThan(20);
    });

    it("schema accepts an empty object (no params required)", () => {
      expect(() => tool.schema.parse({})).not.toThrow();
    });
  });
});

// ── makeGitTools: schema-level checks ────────────────────────────────────────

describe("makeGitTools", () => {
  const tools = makeGitTools();
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

  it("returns exactly 1 tool: git_log_window", () => {
    expect(tools.map((t) => t.name)).toEqual(["git_log_window"]);
  });

  describe("git_log_window", () => {
    const tool = byName["git_log_window"];

    it("has a non-empty description", () => {
      expect(tool.description.trim().length).toBeGreaterThan(20);
    });

    it("schema accepts valid repo/sinceIso/untilIso", () => {
      expect(() =>
        tool.schema.parse({
          repo: "/Users/dev/my-project",
          sinceIso: "2026-07-01T00:00:00Z",
          untilIso: "2026-07-04T23:59:59Z",
        }),
      ).not.toThrow();
    });

    it("schema rejects missing repo", () => {
      expect(() =>
        tool.schema.parse({
          sinceIso: "2026-07-01T00:00:00Z",
          untilIso: "2026-07-04T23:59:59Z",
        }),
      ).toThrow();
    });

    it("schema rejects missing sinceIso", () => {
      expect(() =>
        tool.schema.parse({
          repo: "/path/to/repo",
          untilIso: "2026-07-04T23:59:59Z",
        }),
      ).toThrow();
    });

    it("schema rejects missing untilIso", () => {
      expect(() =>
        tool.schema.parse({
          repo: "/path/to/repo",
          sinceIso: "2026-07-01T00:00:00Z",
        }),
      ).toThrow();
    });

    it("execute returns GIT_ERROR string for invalid repo path (does not throw)", async () => {
      const result = await tool.execute({
        repo: "/nonexistent/path/xyz-should-not-exist",
        sinceIso: "2026-07-01T00:00:00Z",
        untilIso: "2026-07-04T23:59:59Z",
      });
      expect(typeof result).toBe("string");
      expect(result as string).toMatch(/^GIT_ERROR:/);
    });

    it("execute returns a string for a valid real repo path (the project itself)", async () => {
      // Use the actual project repo — it must exist in CI and locally
      const result = await tool.execute({
        repo: "/Users/giladkoch/dev/intent-ai",
        sinceIso: "2020-01-01T00:00:00Z",
        untilIso: "2099-12-31T23:59:59Z",
      });
      expect(typeof result).toBe("string");
      // Must not be an error — real commits exist in this range
      expect(result as string).not.toMatch(/^GIT_ERROR:/);
    });
  });
});
