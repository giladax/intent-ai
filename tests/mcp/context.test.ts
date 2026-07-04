import { describe, it, expect } from "vitest";
import { looksLikeFilePath } from "../../src/mcp/context.js";

describe("looksLikeFilePath", () => {
  it("treats path-shaped strings as files", () => {
    expect(looksLikeFilePath("src/mcp/server.ts")).toBe(true);
    expect(looksLikeFilePath("./src/storage/queries.ts")).toBe(true);
    expect(looksLikeFilePath("/Users/dev/intent-ai/src/cli/index.ts")).toBe(true);
    expect(looksLikeFilePath("server.ts")).toBe(true);
  });

  it("treats natural-language task descriptions as tasks", () => {
    expect(looksLikeFilePath("add a new MCP tool that lists recent events")).toBe(false);
    expect(looksLikeFilePath("emit a coding:struggle activity event")).toBe(false);
    expect(looksLikeFilePath("fix the digest --dry-run flag")).toBe(false);
  });

  it("a sentence that merely mentions a file is still a task", () => {
    expect(looksLikeFilePath("update src/mcp/server.ts to add brain_recent")).toBe(false);
  });
});
