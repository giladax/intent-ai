import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Mock the storage layer so no Postgres is needed (hoisted above the import).
const { emitEventsMock } = vi.hoisted(() => ({
  emitEventsMock: vi.fn(async () => ["id"]),
}));
vi.mock("../../src/storage/queries.js", () => ({
  emitEvents: emitEventsMock,
}));

import {
  buildMcpReadEvent,
  emitMcpReadEvent,
  getRepoContext,
  resetRepoContextCache,
} from "../../src/mcp/instrument.js";

describe("buildMcpReadEvent", () => {
  it("builds a namespaced mcp:<tool> event with the Journal contract fields", () => {
    const ev = buildMcpReadEvent({
      tool: "enter",
      outcome: "hit",
      summary: "Agent entered the Brain for file src/mcp/server.ts",
      latencyMs: 42,
      actor: "agent:claude-code",
      sessionId: "sess-1",
      featureId: "feat-1",
      repo: "intent-ai",
      branch: "feat/repo-brain",
      metadata: { file: "src/mcp/server.ts" },
    });

    expect(ev.category).toBe("mcp:enter");
    expect(ev.tags).toEqual(["mcp", "hit"]);
    expect(ev.actor).toBe("agent:claude-code");
    expect(ev.sourceType).toBe("mcp");
    expect(ev.sessionId).toBe("sess-1");
    expect(ev.repo).toBe("intent-ai");
    expect(ev.branch).toBe("feat/repo-brain");
    expect(ev.metadata).toMatchObject({
      tool: "enter",
      outcome: "hit",
      latencyMs: 42,
      featureId: "feat-1",
      file: "src/mcp/server.ts",
    });
    expect(ev.timestamp).toBeInstanceOf(Date);
  });

  it("defaults featureId to null in metadata (misses have no feature)", () => {
    const ev = buildMcpReadEvent({
      tool: "search",
      outcome: "miss",
      summary: 'Agent searched the brain for "daemon" — 0 results',
      latencyMs: 5,
      actor: "agent:mcp-client",
    });
    expect(ev.metadata.featureId).toBeNull();
    expect(ev.tags).toContain("miss");
    expect(ev.sessionId).toBeUndefined();
  });
});

describe("emitMcpReadEvent", () => {
  beforeEach(() => emitEventsMock.mockClear());

  it("emits through emitEvents", async () => {
    const ev = buildMcpReadEvent({
      tool: "enter",
      outcome: "hit",
      summary: "s",
      latencyMs: 1,
      actor: "agent:x",
    });
    await emitMcpReadEvent(ev);
    expect(emitEventsMock).toHaveBeenCalledTimes(1);
    expect(emitEventsMock.mock.calls[0][0]).toEqual([ev]);
  });

  it("never throws when emission fails (instrumentation is failure-safe)", async () => {
    emitEventsMock.mockRejectedValueOnce(new Error("postgres down"));
    const ev = buildMcpReadEvent({
      tool: "enter",
      outcome: "error",
      summary: "s",
      latencyMs: 1,
      actor: "agent:x",
    });
    await expect(emitMcpReadEvent(ev)).resolves.toBeUndefined();
  });
});

describe("getRepoContext", () => {
  let dir: string;

  beforeEach(() => {
    resetRepoContextCache();
    dir = mkdtempSync(join(tmpdir(), "instrument-test-"));
  });

  afterEach(() => {
    resetRepoContextCache();
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads repo name from cwd and branch from .git/HEAD", () => {
    mkdirSync(join(dir, ".git"));
    writeFileSync(join(dir, ".git", "HEAD"), "ref: refs/heads/feat/repo-brain\n");
    const ctx = getRepoContext(dir);
    expect(ctx.repo).toBe(dir.split("/").pop());
    expect(ctx.branch).toBe("feat/repo-brain");
  });

  it("survives a missing .git (repo name only)", () => {
    const ctx = getRepoContext(dir);
    expect(ctx.repo).toBe(dir.split("/").pop());
    expect(ctx.branch).toBeUndefined();
  });

  it("survives a detached HEAD (no ref line)", () => {
    mkdirSync(join(dir, ".git"));
    writeFileSync(join(dir, ".git", "HEAD"), "abc123def456\n");
    const ctx = getRepoContext(dir);
    expect(ctx.branch).toBeUndefined();
  });
});
