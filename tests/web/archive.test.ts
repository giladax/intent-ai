import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  joinArchive,
  readRawSessionArchive,
  type RawArchiveFile,
  type DigestedSessionRef,
} from "../../src/web/archive.js";

function raw(hash: string, over: Partial<RawArchiveFile> = {}): RawArchiveFile {
  return {
    file: `${hash}.jsonl`,
    hash,
    sizeBytes: 1024,
    lastModified: "2026-07-04T02:54:00.000Z",
    ...over,
  };
}

describe("joinArchive", () => {
  it("marks files digested when a session carries the source_hash", () => {
    const files = [raw("aaa"), raw("bbb")];
    const sessions: DigestedSessionRef[] = [
      { id: "s-1", sourceHash: "aaa", startedAt: "2026-07-01T10:00:00.000Z" },
    ];
    const entries = joinArchive(files, sessions);
    const a = entries.find((e) => e.hash === "aaa")!;
    const b = entries.find((e) => e.hash === "bbb")!;
    expect(a.digested).toBe(true);
    expect(a.sessionId).toBe("s-1");
    expect(a.startedAt).toBe("2026-07-01T10:00:00.000Z");
    expect(b.digested).toBe(false);
    expect(b.sessionId).toBeNull();
  });

  it("ignores sessions with a null source_hash (legacy rows never match)", () => {
    const entries = joinArchive([raw("aaa")], [{ id: "s-x", sourceHash: null, startedAt: null }]);
    expect(entries[0].digested).toBe(false);
  });

  it("sorts newest-first by lastModified", () => {
    const entries = joinArchive(
      [
        raw("old", { lastModified: "2026-06-01T00:00:00.000Z" }),
        raw("new", { lastModified: "2026-07-04T00:00:00.000Z" }),
        raw("mid", { lastModified: "2026-06-20T00:00:00.000Z" }),
      ],
      [],
    );
    expect(entries.map((e) => e.hash)).toEqual(["new", "mid", "old"]);
  });

  it("carries file metadata through to the entry", () => {
    const [e] = joinArchive([raw("aaa", { sizeBytes: 5726738 })], []);
    expect(e.file).toBe("aaa.jsonl");
    expect(e.sizeBytes).toBe(5726738);
  });

  it("handles empty inputs", () => {
    expect(joinArchive([], [])).toEqual([]);
    expect(joinArchive([], [{ id: "s", sourceHash: "h", startedAt: null }])).toEqual([]);
  });
});

describe("readRawSessionArchive", () => {
  it("returns [] for a missing directory (fail-safe)", () => {
    expect(readRawSessionArchive("/nonexistent/raw-sessions")).toEqual([]);
  });

  it("lists only .jsonl files with size and hash", () => {
    const dir = mkdtempSync(join(tmpdir(), "raw-sessions-"));
    try {
      writeFileSync(join(dir, "abc-123.jsonl"), "x".repeat(42));
      writeFileSync(join(dir, "notes.txt"), "ignore me");
      mkdirSync(join(dir, "sub.jsonl")); // a directory with the extension is skipped
      const files = readRawSessionArchive(dir);
      expect(files).toHaveLength(1);
      expect(files[0].hash).toBe("abc-123");
      expect(files[0].file).toBe("abc-123.jsonl");
      expect(files[0].sizeBytes).toBe(42);
      expect(new Date(files[0].lastModified).getTime()).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
