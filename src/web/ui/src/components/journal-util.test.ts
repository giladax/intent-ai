import { describe, it, expect } from "vitest";
import {
  stripIdPrefix,
  shortId,
  formatDuration,
  dayKey,
  groupByDay,
  unreadCount,
  showUnreadLine,
  matchesClause,
  matchesSearch,
  episodeGlyph,
  beatGlyph,
  beatLabel,
  beatIsMiss,
} from "./journal-util.js";
import type { JournalEpisode } from "../types.js";

function ep(partial: Partial<JournalEpisode> & { id: string; startedAt: string }): JournalEpisode {
  return {
    kind: "event",
    title: "",
    actor: "system:pipeline",
    endedAt: null,
    featureIds: [],
    counts: { beats: 0, consults: 0, consultMisses: 0, observations: 0, moments: 0 },
    pending: [],
    beats: [],
    ...partial,
  };
}

describe("id helpers", () => {
  it("strips a namespace prefix", () => {
    expect(stripIdPrefix("session:abc123")).toBe("abc123");
    expect(stripIdPrefix("noprefix")).toBe("noprefix");
  });
  it("shortens long ids", () => {
    expect(shortId("session:0123456789")).toBe("01234567");
    expect(shortId("run:short")).toBe("short");
  });
});

describe("formatDuration", () => {
  it("returns minutes under an hour", () => {
    expect(formatDuration("2026-07-03T11:30:00Z", "2026-07-03T12:17:00Z")).toBe("47 min");
  });
  it("returns h/m over an hour", () => {
    expect(formatDuration("2026-07-03T11:00:00Z", "2026-07-03T12:12:00Z")).toBe("1h 12m");
    expect(formatDuration("2026-07-03T11:00:00Z", "2026-07-03T13:00:00Z")).toBe("2h");
  });
  it("guards missing/inverted bounds", () => {
    expect(formatDuration(null, "2026-07-03T12:00:00Z")).toBeNull();
    expect(formatDuration("2026-07-03T12:00:00Z", null)).toBeNull();
    expect(formatDuration("2026-07-03T12:00:00Z", "2026-07-03T11:00:00Z")).toBeNull();
  });
});

describe("dayKey / groupByDay", () => {
  it("keys by local calendar day", () => {
    expect(dayKey("2026-07-03T12:00:00")).toBe("2026-07-03");
  });
  it("groups newest-first episodes into contiguous day chapters, preserving order", () => {
    const episodes = [
      ep({ id: "a", startedAt: "2026-07-03T14:00:00" }),
      ep({ id: "b", startedAt: "2026-07-03T09:00:00" }),
      ep({ id: "c", startedAt: "2026-07-02T21:00:00" }),
    ];
    const chapters = groupByDay(episodes, new Date("2026-07-03T18:00:00"));
    expect(chapters.map((c) => c.key)).toEqual(["2026-07-03", "2026-07-02"]);
    expect(chapters[0].episodes.map((e) => e.id)).toEqual(["a", "b"]);
    expect(chapters[1].episodes.map((e) => e.id)).toEqual(["c"]);
  });
});

describe("unread cursor", () => {
  const episodes = [
    ep({ id: "new1", startedAt: "2026-07-03T14:00:00Z" }),
    ep({ id: "new2", startedAt: "2026-07-03T12:00:00Z" }),
    ep({ id: "seen1", startedAt: "2026-07-02T09:00:00Z" }),
  ];
  it("counts episodes newer than the cursor (newest-first short-circuit)", () => {
    expect(unreadCount(episodes, "2026-07-03T11:00:00Z")).toBe(2);
    expect(unreadCount(episodes, null)).toBe(0);
    expect(unreadCount(episodes, "2026-07-04T00:00:00Z")).toBe(0);
  });
  it("shows the divider only when new and seen content both exist", () => {
    expect(showUnreadLine(episodes, "2026-07-03T11:00:00Z")).toBe(2);
    expect(showUnreadLine(episodes, "2026-07-01T00:00:00Z")).toBeNull(); // all new
    expect(showUnreadLine(episodes, "2026-07-04T00:00:00Z")).toBeNull(); // none new
    expect(showUnreadLine(episodes, null)).toBeNull();
  });
});

describe("clause + search lenses", () => {
  it("matches clauses against episode shape", () => {
    const session = ep({ id: "s", startedAt: "x", kind: "session", counts: { beats: 5, consults: 3, consultMisses: 1, observations: 2, moments: 4 } });
    expect(matchesClause(session, "sessions")).toBe(true);
    expect(matchesClause(session, "consults")).toBe(true);
    expect(matchesClause(session, "misses")).toBe(true);
    expect(matchesClause(session, "observations")).toBe(true);
    expect(matchesClause(session, "learnings")).toBe(false);
    expect(matchesClause(session, null)).toBe(true);

    const review = ep({ id: "r", startedAt: "x", kind: "review-batch" });
    expect(matchesClause(review, "learnings")).toBe(true);
  });
  it("searches title, actor, beats and pending", () => {
    const e = ep({
      id: "s",
      startedAt: "x",
      title: "Wired MCP self-instrumentation",
      actor: "agent:claude-code",
      beats: [{ id: "b1", timestamp: "x", category: "mcp:search", summary: "brain_search miss", actor: "a", metadata: {} }],
      pending: [{ id: "p1", summary: "wrap emitEvents in try/catch", featureId: null, category: "observation:constraint" }],
    });
    expect(matchesSearch(e, "MCP")).toBe(true);
    expect(matchesSearch(e, "claude")).toBe(true);
    expect(matchesSearch(e, "try/catch")).toBe(true);
    expect(matchesSearch(e, "brain_search")).toBe(true);
    expect(matchesSearch(e, "nonexistent")).toBe(false);
    expect(matchesSearch(e, "  ")).toBe(true);
  });
});

describe("glyphs", () => {
  it("maps episode kind to a glyph", () => {
    expect(episodeGlyph("session")).toBe("⌁");
    expect(episodeGlyph("observation")).toBe("◉");
    expect(episodeGlyph("review-batch")).toBe("✓");
    expect(episodeGlyph("run")).toBe("⚙");
    expect(episodeGlyph("event")).toBe("◇");
  });
  it("maps beat categories to glyphs and labels", () => {
    expect(beatGlyph("mcp:search")).toBe("↳");
    expect(beatGlyph("observation:constraint")).toBe("●");
    expect(beatGlyph("review:approved")).toBe("✓");
    expect(beatGlyph("decision")).toBe("◆");
    expect(beatGlyph("discovery")).toBe("✦");
    expect(beatGlyph("struggle")).toBe("⚠");
    expect(beatGlyph("moment")).toBe("·");
    expect(beatLabel("observation:constraint")).toBe("constraint");
    expect(beatLabel("decision")).toBe("decision");
  });
  it("detects consult misses from metadata", () => {
    expect(beatIsMiss({ outcome: "miss" })).toBe(true);
    expect(beatIsMiss({ outcome: "hit" })).toBe(false);
    expect(beatIsMiss(null)).toBe(false);
    expect(beatIsMiss(undefined)).toBe(false);
  });
});
