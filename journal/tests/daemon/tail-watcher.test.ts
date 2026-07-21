import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TailWatcher } from '../../src/daemon/tail-watcher.js';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('TailWatcher', () => {
  let tmpDir: string;
  let watcher: TailWatcher | null = null;

  afterEach(() => {
    watcher?.stop();
    watcher = null;
    if (tmpDir) {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  });

  it('reads existing lines on start', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tail-watcher-'));
    const filePath = join(tmpDir, 'test.jsonl');

    writeFileSync(filePath, '{"a":1}\n{"b":2}\n');

    const lines: Record<string, unknown>[] = [];
    watcher = new TailWatcher(filePath, (parsed) => lines.push(parsed));
    await watcher.start();

    await wait(200);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({ a: 1 });
    expect(lines[1]).toEqual({ b: 2 });
  });

  it('detects new lines appended after start', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tail-watcher-'));
    const filePath = join(tmpDir, 'test.jsonl');

    writeFileSync(filePath, '{"first":true}\n');

    const lines: Record<string, unknown>[] = [];
    watcher = new TailWatcher(filePath, (parsed) => lines.push(parsed));
    await watcher.start();

    await wait(200);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual({ first: true });

    appendFileSync(filePath, '{"second":true}\n');

    // Wait for poll/watcher to pick up the change
    await wait(1500);

    expect(lines).toHaveLength(2);
    expect(lines[1]).toEqual({ second: true });
  });

  it('buffers partial lines', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tail-watcher-'));
    const filePath = join(tmpDir, 'test.jsonl');

    // Write partial JSON (no trailing newline)
    writeFileSync(filePath, '{"partial":');

    const lines: Record<string, unknown>[] = [];
    watcher = new TailWatcher(filePath, (parsed) => lines.push(parsed));
    await watcher.start();

    await wait(200);
    expect(lines).toHaveLength(0);

    // Complete the line
    appendFileSync(filePath, 'true}\n');

    await wait(1500);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual({ partial: true });
  });

  it('skips invalid JSON lines', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tail-watcher-'));
    const filePath = join(tmpDir, 'test.jsonl');

    writeFileSync(filePath, '{"valid":1}\nnot json\n{"valid":2}\n');

    const lines: Record<string, unknown>[] = [];
    watcher = new TailWatcher(filePath, (parsed) => lines.push(parsed));
    await watcher.start();

    await wait(200);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({ valid: 1 });
    expect(lines[1]).toEqual({ valid: 2 });
  });

  it('waits for file to exist', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tail-watcher-'));
    const filePath = join(tmpDir, 'delayed.jsonl');

    const lines: Record<string, unknown>[] = [];
    watcher = new TailWatcher(filePath, (parsed) => lines.push(parsed));

    // Start watcher before file exists
    const startPromise = watcher.start();

    // File doesn't exist yet, no lines
    await wait(200);
    expect(lines).toHaveLength(0);

    // Create the file after a delay
    writeFileSync(filePath, '{"delayed":true}\n');

    await startPromise;
    await wait(200);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual({ delayed: true });
  });
});
