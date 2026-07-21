/**
 * JSONL tail watcher — follows a file and emits parsed JSON lines.
 *
 * Uses fs.watch for real-time change detection with a poll fallback
 * since fs.watch can miss events on some platforms.
 */

import { watch, type FSWatcher, existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';

type LineCallback = (parsed: Record<string, unknown>) => void;

export class TailWatcher {
  private filePath: string;
  private onLine: LineCallback;
  private offset = 0;
  private buffer = '';
  private watcher: FSWatcher | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(filePath: string, onLine: LineCallback) {
    this.filePath = filePath;
    this.onLine = onLine;
  }

  async start(): Promise<void> {
    // 1. Wait for file to exist (poll every 500ms if not found)
    await this.waitForFile();
    if (this.stopped) return;

    // 2. Read existing content from offset 0 to EOF, parse lines
    await this.readNewLines();
    if (this.stopped) return;

    // 3. Set up fs.watch on the file for 'change' events
    try {
      this.watcher = watch(this.filePath, (_eventType) => {
        if (this.stopped) return;
        this.readNewLines().catch((err) => {
          console.warn(`[tail-watcher] Error reading on change: ${err}`);
        });
      });

      this.watcher.on('error', (err) => {
        console.warn(`[tail-watcher] Watcher error: ${err}`);
      });
    } catch (err) {
      console.warn(`[tail-watcher] Could not set up fs.watch: ${err}`);
    }

    // 4. Poll fallback every 1s since fs.watch can miss events
    this.pollTimer = setInterval(() => {
      if (this.stopped) return;
      this.readNewLines().catch((err) => {
        console.warn(`[tail-watcher] Poll error: ${err}`);
      });
    }, 1000);
  }

  private async waitForFile(): Promise<void> {
    while (!this.stopped && !existsSync(this.filePath)) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  private async readNewLines(): Promise<void> {
    try {
      const fileStat = await stat(this.filePath);
      const fileSize = fileStat.size;

      if (fileSize <= this.offset) return;

      const content = await readFile(this.filePath, 'utf-8');
      const newContent = content.slice(this.offset);
      this.offset = content.length;

      this.buffer += newContent;

      const lines = this.buffer.split('\n');
      // Keep the last element as buffer (incomplete line or empty string)
      this.buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const parsed = JSON.parse(trimmed) as Record<string, unknown>;
          this.onLine(parsed);
        } catch {
          console.warn(`[tail-watcher] Skipping invalid JSON line: ${trimmed.slice(0, 100)}`);
        }
      }
    } catch (err) {
      console.warn(`[tail-watcher] Error reading file: ${err}`);
    }
  }

  stop(): void {
    this.stopped = true;
    this.watcher?.close();
    this.watcher = null;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
