import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const CLAUDE_PROJECTS_DIR = join(homedir(), ".claude", "projects");

interface LogFile {
  path: string;
  mtime: Date;
}

/** Recursively collect all .jsonl files under a directory */
async function collectJsonl(dir: string): Promise<LogFile[]> {
  const results: LogFile[] = [];

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectJsonl(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      const info = await stat(fullPath);
      results.push({ path: fullPath, mtime: info.mtime });
    }
  }

  return results;
}

/**
 * Find the most recent JSONL log in ~/.claude/projects/.
 * If projectDir is provided, scopes to that project's subdirectory.
 */
export async function discoverLatestLog(
  projectDir?: string,
): Promise<string | null> {
  const logs = await discoverLogs(1, projectDir);
  return logs[0] ?? null;
}

/**
 * Return the N most recent JSONL log files, newest first.
 * If projectDir is provided, scopes to that project's subdirectory.
 */
export async function discoverLogs(
  count: number,
  projectDir?: string,
): Promise<string[]> {
  const searchDir = projectDir
    ? join(CLAUDE_PROJECTS_DIR, projectDir)
    : CLAUDE_PROJECTS_DIR;

  const files = await collectJsonl(searchDir);

  files.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  return files.slice(0, count).map((f) => f.path);
}
