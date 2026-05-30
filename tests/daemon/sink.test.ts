import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSink } from '../../src/daemon/sink.js';
import type { ObservedEvent } from '../../src/daemon/types.js';

describe('FileSink', () => {
  const tmpPath = join(tmpdir(), `sink-test-${Date.now()}.ndjson`);

  afterEach(() => {
    if (existsSync(tmpPath)) unlinkSync(tmpPath);
  });

  it('writes 3 events as valid NDJSON lines', () => {
    const sink = new FileSink(tmpPath);

    const events: ObservedEvent[] = [
      {
        source: 'hook',
        sessionId: 'sess-1',
        kind: 'user_prompt',
        ts: Date.now(),
        raw: { text: 'hello' },
        prompt: 'Fix the bug in auth module',
      },
      {
        source: 'jsonl',
        sessionId: 'sess-1',
        kind: 'tool_call',
        ts: Date.now(),
        raw: { tool: 'Read' },
        toolName: 'Read',
        toolUseId: 'tu-123',
      },
      {
        source: 'hook',
        sessionId: 'sess-1',
        kind: 'assistant_stop',
        ts: Date.now(),
        raw: {},
      },
    ];

    for (const evt of events) {
      sink.ingest(evt);
    }

    const content = readFileSync(tmpPath, 'utf-8').trim();
    const lines = content.split('\n');
    expect(lines).toHaveLength(3);

    const parsed = lines.map((l) => JSON.parse(l));
    expect(parsed[0].kind).toBe('user_prompt');
    expect(parsed[0].prompt).toBe('Fix the bug in auth module');
    expect(parsed[1].kind).toBe('tool_call');
    expect(parsed[1].toolName).toBe('Read');
    expect(parsed[2].kind).toBe('assistant_stop');
  });
});
