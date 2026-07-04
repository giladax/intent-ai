// Pure, dependency-free helpers for the Journal.
// No React, no date-fns — only native Intl/Date so this module is unit-testable
// from the repo root vitest runner without the UI's node_modules on the path.
import type { JournalEpisode } from "../types";

// ── id helpers ────────────────────────────────────────────────────────
/** "session:abc123" -> "abc123"; ids without a known prefix return unchanged. */
export function stripIdPrefix(id: string): string {
  const i = id.indexOf(":");
  return i === -1 ? id : id.slice(i + 1);
}

/** A short, human-scannable id fragment. */
export function shortId(id: string): string {
  const raw = stripIdPrefix(id);
  return raw.length <= 8 ? raw : raw.slice(0, 8);
}

// ── duration ──────────────────────────────────────────────────────────
/** "47 min" / "1h 12m" / null when either bound is missing or non-positive. */
export function formatDuration(startedAt: string | null, endedAt: string | null): string | null {
  if (!startedAt || !endedAt) return null;
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 1) return "<1 min";
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// ── day chapters ──────────────────────────────────────────────────────
/** Local calendar-day key, YYYY-MM-DD. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** "Today · Thu 3 Jul" / "Yesterday · Wed 2 Jul" / "Mon 30 Jun". */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const key = dayKey(iso);
  const todayKey = dayKey(now.toISOString());
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const pretty = new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  if (key === todayKey) return `Today · ${pretty}`;
  if (key === dayKey(yesterday.toISOString())) return `Yesterday · ${pretty}`;
  return pretty;
}

export interface DayChapter {
  key: string;
  label: string;
  episodes: JournalEpisode[];
}

/**
 * Group already-sorted (newest-first) episodes into day chapters, preserving
 * that order. Chapters come out newest-day-first; episodes within a chapter
 * keep their incoming order.
 */
export function groupByDay(episodes: JournalEpisode[], now: Date = new Date()): DayChapter[] {
  const chapters: DayChapter[] = [];
  let current: DayChapter | null = null;
  for (const ep of episodes) {
    const key = dayKey(ep.startedAt);
    if (!current || current.key !== key) {
      current = { key, label: dayLabel(ep.startedAt, now), episodes: [] };
      chapters.push(current);
    }
    current.episodes.push(ep);
  }
  return chapters;
}

// ── unread cursor ─────────────────────────────────────────────────────
/**
 * Number of episodes newer than the stored read-cursor. Episodes are assumed
 * newest-first. Returns 0 when there is no cursor or nothing is new.
 */
export function unreadCount(episodes: JournalEpisode[], lastLooked: string | null): number {
  if (!lastLooked) return 0;
  const cutoff = new Date(lastLooked).getTime();
  if (!Number.isFinite(cutoff)) return 0;
  let n = 0;
  for (const ep of episodes) {
    if (new Date(ep.startedAt).getTime() > cutoff) n++;
    else break; // newest-first: once we hit a seen one, the rest are seen too
  }
  return n;
}

/**
 * Whether to draw the "you last looked here" divider, and after how many
 * episodes. Only shown when there is both new and older content to separate.
 */
export function showUnreadLine(episodes: JournalEpisode[], lastLooked: string | null): number | null {
  const n = unreadCount(episodes, lastLooked);
  if (n <= 0 || n >= episodes.length) return null;
  return n;
}

// ── clause filters (Pulse strip) ──────────────────────────────────────
export type ClauseFilter = "sessions" | "consults" | "misses" | "observations" | "learnings";

export function matchesClause(ep: JournalEpisode, clause: ClauseFilter | null): boolean {
  if (!clause) return true;
  switch (clause) {
    case "sessions":
      return ep.kind === "session";
    case "consults":
      return ep.counts.consults > 0;
    case "misses":
      return ep.counts.consultMisses > 0;
    case "observations":
      return ep.kind === "observation" || ep.counts.observations > 0 || ep.pending.length > 0;
    case "learnings":
      return ep.kind === "review-batch";
    default:
      return true;
  }
}

// ── free-text search ──────────────────────────────────────────────────
export function matchesSearch(ep: JournalEpisode, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (ep.title.toLowerCase().includes(q)) return true;
  if (ep.actor.toLowerCase().includes(q)) return true;
  for (const b of ep.beats) if (b.summary.toLowerCase().includes(q)) return true;
  for (const p of ep.pending) if (p.summary.toLowerCase().includes(q)) return true;
  return false;
}

// ── glyphs ────────────────────────────────────────────────────────────
/** Left-margin actor glyph for an episode, chosen by kind. */
export function episodeGlyph(kind: JournalEpisode["kind"]): string {
  switch (kind) {
    case "session":
      return "⌁";
    case "observation":
      return "◉";
    case "review-batch":
      return "✓";
    case "run":
      return "⚙";
    default:
      return "◇";
  }
}

/** Beat glyph by (freeform) category, matching the design's beat vocabulary. */
export function beatGlyph(category: string): string {
  const c = category.toLowerCase();
  if (c.startsWith("mcp:")) return "↳";
  if (c.startsWith("eval:")) return "⚖";
  if (c.startsWith("observation:")) return "●";
  if (c.startsWith("review:")) return "✓";
  if (c.includes("decision")) return "◆";
  if (c.includes("discovery")) return "✦";
  if (c.includes("struggle") || c.includes("blocker")) return "⚠";
  if (c.includes("outcome")) return "✓";
  if (c.includes("transition")) return "→";
  return "·";
}

/** A short, readable label for a freeform category (the part after the ":"). */
export function beatLabel(category: string): string {
  const i = category.indexOf(":");
  return (i === -1 ? category : category.slice(i + 1)) || category;
}

/** MCP consult beats stamp metadata.outcome; a "miss" is a product signal. */
export function beatIsMiss(metadata: Record<string, unknown> | null | undefined): boolean {
  return !!metadata && metadata["outcome"] === "miss";
}

// ── the inkwell — semantic tones ──────────────────────────────────────
// Six inks, one meaning each (defined as --j-* accents in app-ink.css):
// red = struggle/miss, moss = verified/outcome, consult = MCP,
// gold = discovery/observation, violet = pivot/transition, teal = decision.
export type InkTone = "red" | "moss" | "consult" | "gold" | "violet" | "teal";

/** Tone for a beat, by (freeform) category — misses always read red. */
export function beatTone(
  category: string,
  metadata?: Record<string, unknown> | null,
): InkTone | undefined {
  if (beatIsMiss(metadata)) return "red";
  const c = category.toLowerCase();
  if (c.startsWith("mcp:")) return "consult";
  if (c.startsWith("observation:")) return "gold";
  if (c.startsWith("review:") || c.includes("outcome") || c.includes("confirmation")) return "moss";
  if (c.includes("struggle") || c.includes("blocker") || c.includes("rejection")) return "red";
  if (c.includes("discovery") || c.includes("realization") || c.includes("breakthrough")) return "gold";
  if (c.includes("pivot") || c.includes("transition") || c.includes("refactor")) return "violet";
  if (c.includes("decision") || c.includes("commitment") || c.includes("proposal")) return "teal";
  if (c.startsWith("eval:")) return "violet";
  return undefined;
}

/**
 * Tone for an episode's spine node. Urgency wins: anything pending or
 * missed reads red; otherwise the episode kind picks its ink.
 */
export function episodeTone(
  kind: JournalEpisode["kind"],
  opts: { pending?: number; consultMisses?: number } = {},
): InkTone | undefined {
  if ((opts.pending ?? 0) > 0 || (opts.consultMisses ?? 0) > 0) return "red";
  switch (kind) {
    case "review-batch":
      return "moss";
    case "observation":
      return "gold";
    case "run":
      return "violet";
    default:
      return undefined; // sessions stay ink — the river's baseline
  }
}

/** Tone for a moment type (session detail's ledger of moments). */
export function momentTone(type: string | null | undefined): InkTone | undefined {
  switch ((type ?? "").toLowerCase()) {
    case "discovery":
    case "realization":
    case "breakthrough":
      return "gold";
    case "decision":
    case "commitment":
    case "proposal":
      return "teal";
    case "pivot":
    case "transition":
    case "refactor":
      return "violet";
    case "confirmation":
      return "moss";
    case "struggle":
    case "rejection":
      return "red";
    default:
      return undefined; // implementation/execution stay ink
  }
}
