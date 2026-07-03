import { describe, it, expect } from "vitest";
import {
  groupEpisodes,
  buildPulse,
  buildJournal,
  isConsultMiss,
  type JournalEventRow,
  type JournalSessionRow,
} from "../../src/web/journal.js";

// ── Fixtures ──────────────────────────────────────────────────────────

function ev(over: Partial<JournalEventRow> & { id: string }): JournalEventRow {
  return {
    timestamp: "2026-07-03T10:00:00.000Z",
    category: "event:generic",
    actor: "system:pipeline",
    summary: "something happened",
    metadata: {},
    ...over,
  };
}

describe("groupEpisodes — precedence rule 1 (session_id)", () => {
  it("folds all session-scoped beats (incl. legacy + mcp + observation) into one session episode", () => {
    const events: JournalEventRow[] = [
      ev({
        id: "m1",
        sessionId: "sess-A",
        sourceType: "moment",
        category: "decision",
        summary: "chose approach X",
        timestamp: "2026-07-03T10:05:00.000Z",
      }),
      ev({
        id: "mcp1",
        sessionId: "sess-A",
        category: "mcp:enter",
        summary: "consulted brain_enter",
        metadata: { outcome: "hit" },
        timestamp: "2026-07-03T10:06:00.000Z",
      }),
      ev({
        id: "obs1",
        sessionId: "sess-A",
        category: "observation:constraint",
        reviewStatus: "pending",
        featureId: "feat-1",
        summary: "wrap emitEvents in try/catch",
        timestamp: "2026-07-03T10:07:00.000Z",
      }),
    ];
    const sessions: JournalSessionRow[] = [
      {
        id: "sess-A",
        startedAt: "2026-07-03T09:00:00.000Z",
        endedAt: "2026-07-03T09:47:00.000Z",
        narrativeSummary: "Wired MCP self-instrumentation",
      },
    ];

    const episodes = groupEpisodes(events, sessions);
    expect(episodes).toHaveLength(1);
    const ep = episodes[0];
    expect(ep.kind).toBe("session");
    expect(ep.id).toBe("session:sess-A");
    expect(ep.title).toBe("Wired MCP self-instrumentation");
    // Session timing comes from the sessions table, NOT beat timestamps.
    expect(ep.startedAt).toBe("2026-07-03T09:00:00.000Z");
    expect(ep.endedAt).toBe("2026-07-03T09:47:00.000Z");
    expect(ep.counts).toEqual({
      beats: 3,
      consults: 1,
      consultMisses: 0,
      observations: 1,
      moments: 1,
    });
    expect(ep.featureIds).toEqual(["feat-1"]);
    expect(ep.pending).toEqual([
      { id: "obs1", summary: "wrap emitEvents in try/catch", featureId: "feat-1", category: "observation:constraint" },
    ]);
  });

  it("falls back to a synthesized title when there is no narrative", () => {
    const events: JournalEventRow[] = [
      ev({ id: "m1", sessionId: "sess-B", sourceType: "moment", category: "discovery" }),
      ev({ id: "m2", sessionId: "sess-B", sourceType: "moment", category: "struggle" }),
      ev({ id: "c1", sessionId: "sess-B", category: "mcp:search", metadata: { outcome: "miss" } }),
    ];
    const episodes = groupEpisodes(events, [
      { id: "sess-B", startedAt: "2026-07-03T08:00:00.000Z", endedAt: null },
    ]);
    expect(episodes[0].title).toBe("Session sess-B — 2 moments, 1 consults");
    expect(episodes[0].counts.consultMisses).toBe(1);
  });

  it("uses beat timestamps for session timing only when the session row lacks them", () => {
    const events: JournalEventRow[] = [
      ev({ id: "a", sessionId: "sess-C", timestamp: "2026-07-03T10:10:00.000Z" }),
      ev({ id: "b", sessionId: "sess-C", timestamp: "2026-07-03T10:20:00.000Z" }),
    ];
    // No session row provided at all.
    const episodes = groupEpisodes(events, []);
    expect(episodes[0].startedAt).toBe("2026-07-03T10:10:00.000Z");
    expect(episodes[0].endedAt).toBe("2026-07-03T10:20:00.000Z");
  });
});

describe("groupEpisodes — legacy source_type mapping (moments count)", () => {
  it("counts moments by source_type, not by category", () => {
    const events: JournalEventRow[] = [
      ev({ id: "1", sessionId: "s", sourceType: "moment", category: "decision" }),
      ev({ id: "2", sessionId: "s", sourceType: "moment", category: "discovery" }),
      ev({ id: "3", sessionId: "s", sourceType: "transition", category: "transition" }),
      ev({ id: "4", sessionId: "s", sourceType: "outcome", category: "outcome" }),
      ev({ id: "5", sessionId: "s", sourceType: "narrative", category: "exploration" }),
    ];
    const ep = groupEpisodes(events, [])[0];
    expect(ep.counts.moments).toBe(2);
    expect(ep.counts.beats).toBe(5);
  });
});

describe("groupEpisodes — beat ordering (oldest-first, digest-collapse workaround)", () => {
  it("orders beats oldest-first by timestamp", () => {
    const events: JournalEventRow[] = [
      ev({ id: "late", sessionId: "s", timestamp: "2026-07-03T10:30:00.000Z" }),
      ev({ id: "early", sessionId: "s", timestamp: "2026-07-03T10:10:00.000Z" }),
      ev({ id: "mid", sessionId: "s", timestamp: "2026-07-03T10:20:00.000Z" }),
    ];
    const ep = groupEpisodes(events, [])[0];
    expect(ep.beats.map((b) => b.id)).toEqual(["early", "mid", "late"]);
  });

  it("breaks timestamp ties by a metadata causal-order hint (digest-time collapse)", () => {
    // All timestamps identical — the digest-time collapse. metadata.causalOrder disambiguates.
    const t = "2026-07-03T10:00:00.000Z";
    const events: JournalEventRow[] = [
      ev({ id: "third", sessionId: "s", timestamp: t, metadata: { causalOrder: 3 } }),
      ev({ id: "first", sessionId: "s", timestamp: t, metadata: { causalOrder: 1 } }),
      ev({ id: "second", sessionId: "s", timestamp: t, metadata: { causalOrder: 2 } }),
    ];
    const ep = groupEpisodes(events, [])[0];
    expect(ep.beats.map((b) => b.id)).toEqual(["first", "second", "third"]);
  });
});

describe("groupEpisodes — precedence rule 2 (runId)", () => {
  it("groups non-session events sharing metadata.runId into a run episode", () => {
    const events: JournalEventRow[] = [
      ev({ id: "r1", category: "digest:run", metadata: { runId: "run-9" }, timestamp: "2026-07-03T11:00:00.000Z" }),
      ev({ id: "r2", category: "digest:run", metadata: { runId: "run-9" }, timestamp: "2026-07-03T11:01:00.000Z" }),
    ];
    const episodes = groupEpisodes(events, []);
    expect(episodes).toHaveLength(1);
    expect(episodes[0].kind).toBe("run");
    expect(episodes[0].id).toBe("run:run-9");
    expect(episodes[0].counts.beats).toBe(2);
  });

  it("session_id wins over runId (rule 1 precedence)", () => {
    const events: JournalEventRow[] = [
      ev({ id: "x", sessionId: "sess-Z", metadata: { runId: "run-1" } }),
    ];
    const episodes = groupEpisodes(events, []);
    expect(episodes[0].kind).toBe("session");
    expect(episodes[0].id).toBe("session:sess-Z");
  });
});

describe("groupEpisodes — precedence rule 3 (review-batch)", () => {
  it("collapses review:* by the same actor within 10 minutes into one batch", () => {
    const events: JournalEventRow[] = [
      ev({ id: "rv1", category: "review:approved", actor: "human:local", summary: "approved a constraint", timestamp: "2026-07-03T10:00:00.000Z" }),
      ev({ id: "rv2", category: "review:approved", actor: "human:local", summary: "approved another", timestamp: "2026-07-03T10:05:00.000Z" }),
      ev({ id: "rv3", category: "review:rejected", actor: "human:local", summary: "rejected one", timestamp: "2026-07-03T10:08:00.000Z" }),
    ];
    const episodes = groupEpisodes(events, []);
    expect(episodes).toHaveLength(1);
    const ep = episodes[0];
    expect(ep.kind).toBe("review-batch");
    expect(ep.id).toBe("review:rv1"); // first (earliest) event id
    expect(ep.title).toBe("Reviewed 3 observations"); // mixed actions
    expect(ep.actor).toBe("human:local");
  });

  it("titles a single-action batch by that action", () => {
    const events: JournalEventRow[] = [
      ev({ id: "a", category: "review:approved", actor: "human:local", timestamp: "2026-07-03T10:00:00.000Z" }),
      ev({ id: "b", category: "review:approved", actor: "human:local", timestamp: "2026-07-03T10:02:00.000Z" }),
      ev({ id: "c", category: "review:approved", actor: "human:local", timestamp: "2026-07-03T10:03:00.000Z" }),
    ];
    expect(groupEpisodes(events, [])[0].title).toBe("Approved 3 observations");
  });

  it("splits a batch when the gap exceeds 10 minutes", () => {
    const events: JournalEventRow[] = [
      ev({ id: "a", category: "review:approved", actor: "human:local", timestamp: "2026-07-03T10:00:00.000Z" }),
      ev({ id: "b", category: "review:approved", actor: "human:local", timestamp: "2026-07-03T10:20:00.000Z" }),
    ];
    const episodes = groupEpisodes(events, []);
    expect(episodes).toHaveLength(2);
  });

  it("separates review batches by actor", () => {
    const events: JournalEventRow[] = [
      ev({ id: "a", category: "review:approved", actor: "human:gilad", timestamp: "2026-07-03T10:00:00.000Z" }),
      ev({ id: "b", category: "review:approved", actor: "human:dana", timestamp: "2026-07-03T10:01:00.000Z" }),
    ];
    const episodes = groupEpisodes(events, []);
    expect(episodes).toHaveLength(2);
  });
});

describe("groupEpisodes — precedence rule 4 (singletons)", () => {
  it("makes an unattached observation a singleton 'observation' episode with itself pending", () => {
    const events: JournalEventRow[] = [
      ev({
        id: "obsX",
        category: "observation:pitfall",
        reviewStatus: "pending",
        featureId: "feat-9",
        summary: "emit sites keep landing without try/catch",
      }),
    ];
    const ep = groupEpisodes(events, [])[0];
    expect(ep.kind).toBe("observation");
    expect(ep.id).toBe("event:obsX");
    expect(ep.title).toBe("emit sites keep landing without try/catch");
    expect(ep.endedAt).toBeNull();
    expect(ep.pending).toHaveLength(1);
    expect(ep.pending[0].featureId).toBe("feat-9");
  });

  it("makes any other unattached event a singleton 'event' episode", () => {
    const events: JournalEventRow[] = [ev({ id: "e1", category: "github:pr-merged", summary: "merged PR #42" })];
    const ep = groupEpisodes(events, [])[0];
    expect(ep.kind).toBe("event");
    expect(ep.id).toBe("event:e1");
  });
});

describe("groupEpisodes — episode ordering (newest-first)", () => {
  it("returns episodes newest-first by startedAt", () => {
    const events: JournalEventRow[] = [
      ev({ id: "old", category: "github:x", timestamp: "2026-07-01T10:00:00.000Z" }),
      ev({ id: "new", category: "github:y", timestamp: "2026-07-03T10:00:00.000Z" }),
      ev({ id: "mid", category: "github:z", timestamp: "2026-07-02T10:00:00.000Z" }),
    ];
    const episodes = groupEpisodes(events, []);
    expect(episodes.map((e) => e.id)).toEqual(["event:new", "event:mid", "event:old"]);
  });

  it("positions a session episode by its session-row startedAt, not beat timestamps", () => {
    // Session beats are stamped at digest time (late), but the session actually
    // started earlier — so it must sort by the session row's started_at.
    const events: JournalEventRow[] = [
      ev({ id: "sbeat", sessionId: "s1", timestamp: "2026-07-03T23:00:00.000Z" }),
      ev({ id: "later-event", category: "github:x", timestamp: "2026-07-03T12:00:00.000Z" }),
    ];
    const sessions: JournalSessionRow[] = [
      { id: "s1", startedAt: "2026-07-03T08:00:00.000Z", endedAt: "2026-07-03T09:00:00.000Z" },
    ];
    const episodes = groupEpisodes(events, sessions);
    // github event (12:00) sorts before the session (positioned at 08:00).
    expect(episodes.map((e) => e.id)).toEqual(["event:later-event", "session:s1"]);
  });
});

describe("buildPulse", () => {
  it("computes window counts incl. consultMisses from metadata.outcome", () => {
    const events: JournalEventRow[] = [
      ev({ id: "s1", sessionId: "A", category: "exploration", sourceType: "narrative" }),
      ev({ id: "s2", sessionId: "B", category: "decision", sourceType: "moment" }),
      ev({ id: "c1", sessionId: "A", category: "mcp:enter", metadata: { outcome: "hit" } }),
      ev({ id: "c2", sessionId: "A", category: "mcp:search", metadata: { outcome: "miss" } }),
      ev({ id: "c3", category: "mcp:feature-context", metadata: { outcome: "miss" } }),
      ev({ id: "o1", category: "observation:constraint", reviewStatus: "pending" }),
      ev({ id: "o2", sessionId: "B", category: "observation:pitfall", reviewStatus: "approved" }),
      ev({ id: "rv1", category: "review:approved", actor: "human:local" }),
      ev({ id: "rv2", category: "review:rejected", actor: "human:local" }),
    ];
    const pulse = buildPulse(events, { since: "2026-07-02T00:00:00.000Z", pendingReview: 7 });
    expect(pulse).toEqual({
      since: "2026-07-02T00:00:00.000Z",
      sessionsDigested: 2, // distinct session_id: A, B
      consults: 3,
      consultMisses: 2,
      observationsNoticed: 2,
      pendingReview: 7, // ALL-time, passed through (not derived from window)
      reviewActions: 2,
      learnings: 1, // only review:approved
    });
  });

  it("echoes a null since", () => {
    expect(buildPulse([], { since: null, pendingReview: 0 }).since).toBeNull();
  });
});

describe("isConsultMiss", () => {
  it("is true only for mcp:* beats with outcome 'miss'", () => {
    expect(isConsultMiss(ev({ id: "1", category: "mcp:search", metadata: { outcome: "miss" } }))).toBe(true);
    expect(isConsultMiss(ev({ id: "2", category: "mcp:search", metadata: { outcome: "hit" } }))).toBe(false);
    expect(isConsultMiss(ev({ id: "3", category: "observation:x", metadata: { outcome: "miss" } }))).toBe(false);
  });
});

describe("buildJournal — assembly", () => {
  it("returns both pulse and newest-first episodes", () => {
    const events: JournalEventRow[] = [
      ev({ id: "c1", sessionId: "A", category: "mcp:enter", metadata: { outcome: "hit" }, timestamp: "2026-07-03T10:00:00.000Z" }),
      ev({ id: "e1", category: "github:x", timestamp: "2026-07-03T12:00:00.000Z" }),
    ];
    const sessions: JournalSessionRow[] = [
      { id: "A", startedAt: "2026-07-03T09:00:00.000Z", endedAt: null, narrativeSummary: "worked" },
    ];
    const out = buildJournal({ events, sessions, since: null, pendingReview: 3 });
    expect(out.pulse.consults).toBe(1);
    expect(out.pulse.pendingReview).toBe(3);
    expect(out.episodes.map((e) => e.id)).toEqual(["event:e1", "session:A"]);
  });
});
