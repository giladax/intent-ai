// The local session archive — `.intent/raw-sessions/` holds every raw CC log
// that digestion has read (PRD v0.3.2: evidence outlives Claude Code's ~30-day
// purge; every digest stays permanently re-derivable). This module lists that
// directory and joins it against the sessions table by source_hash, so the
// dashboard can show which preserved evidence is digested and which is not.
//
// Pure join logic is separated from fs so it is unit-testable; the fs read is
// fail-safe (a missing or unreadable directory is an empty archive, never an
// error — the archive is an optional local artifact).

import { readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";

/** A raw session log preserved in .intent/raw-sessions/. */
export interface RawArchiveFile {
  /** File name, e.g. "b9ab1a0c-….jsonl". */
  file: string;
  /** The digest identity: file basename without .jsonl (matches sessions.source_hash). */
  hash: string;
  sizeBytes: number;
  /** ISO timestamp of last modification (re-copied as the log grows). */
  lastModified: string;
}

/** The subset of a sessions row the join needs. */
export interface DigestedSessionRef {
  id: string;
  sourceHash: string | null;
  startedAt: string | null;
}

/** One archive entry as served to the UI. */
export interface ArchiveEntry {
  hash: string;
  file: string;
  sizeBytes: number;
  lastModified: string;
  /** True when a digested session carries this source_hash. */
  digested: boolean;
  /** The digested session's id, for click-through to the record. */
  sessionId: string | null;
  startedAt: string | null;
}

/**
 * Join raw archive files against digested sessions by source_hash.
 * Newest-first by lastModified — the archive reads like the river.
 */
export function joinArchive(
  files: RawArchiveFile[],
  sessions: DigestedSessionRef[],
): ArchiveEntry[] {
  const byHash = new Map<string, DigestedSessionRef>();
  for (const s of sessions) {
    if (s.sourceHash) byHash.set(s.sourceHash, s);
  }
  return files
    .map((f) => {
      const match = byHash.get(f.hash);
      return {
        hash: f.hash,
        file: f.file,
        sizeBytes: f.sizeBytes,
        lastModified: f.lastModified,
        digested: match !== undefined,
        sessionId: match?.id ?? null,
        startedAt: match?.startedAt ?? null,
      };
    })
    .sort((a, b) => b.lastModified.localeCompare(a.lastModified));
}

/**
 * Read the raw-session archive directory. Fail-safe: any fs problem
 * (missing dir, permissions, a file vanishing mid-scan) yields what could
 * be read — worst case an empty list, never a throw.
 */
export function readRawSessionArchive(dir: string): RawArchiveFile[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const files: RawArchiveFile[] = [];
  for (const name of names) {
    if (!name.endsWith(".jsonl")) continue;
    try {
      const st = statSync(join(dir, name));
      if (!st.isFile()) continue;
      files.push({
        file: name,
        hash: basename(name, ".jsonl"),
        sizeBytes: st.size,
        lastModified: st.mtime.toISOString(),
      });
    } catch {
      // a file disappearing between readdir and stat is not an error
    }
  }
  return files;
}
