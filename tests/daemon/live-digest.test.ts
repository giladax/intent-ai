import { describe, it, expect, vi } from 'vitest';
import { liveDigest } from '../../src/daemon/live-digest.js';
import { createSessionState, updateSessionState } from '../../src/daemon/session-state.js';
import type { ObservedEvent } from '../../src/daemon/types.js';

// Mock Anthropic client
function mockClient(responseText: string) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: responseText }],
      }),
    },
  } as any;
}

describe('liveDigest', () => {
  it('returns a valid BatchDigest from LLM response', async () => {
    const client = mockClient(JSON.stringify({
      summary: 'User asked to add a function',
      currentIntent: 'Adding hello world function',
      filesInFocus: ['src/utils.ts'],
      openQuestions: [],
      significantEvent: false,
    }));

    const batch: ObservedEvent[] = [
      { source: 'hook', sessionId: 's1', kind: 'user_prompt', ts: Date.now(), raw: {}, prompt: 'Add hello world' },
    ];
    const state = createSessionState('s1', '/tmp/transcript.jsonl');

    const digest = await liveDigest(batch, state, client);
    expect(digest.summary).toBe('User asked to add a function');
    expect(digest.currentIntent).toBe('Adding hello world function');
    expect(digest.filesInFocus).toEqual(['src/utils.ts']);
    expect(digest.significantEvent).toBe(false);
  });

  it('handles markdown-fenced JSON response', async () => {
    const client = mockClient('```json\n{"summary":"test","currentIntent":"testing","filesInFocus":[],"openQuestions":[],"significantEvent":true}\n```');
    const batch: ObservedEvent[] = [
      { source: 'hook', sessionId: 's1', kind: 'assistant_stop', ts: Date.now(), raw: {} },
    ];
    const state = createSessionState('s1', '/tmp/t.jsonl');

    const digest = await liveDigest(batch, state, client);
    expect(digest.summary).toBe('test');
    expect(digest.significantEvent).toBe(true);
  });

  it('applies Zod defaults for missing optional fields', async () => {
    const client = mockClient(JSON.stringify({
      summary: 'minimal',
      currentIntent: 'doing stuff',
    }));
    const batch: ObservedEvent[] = [
      { source: 'hook', sessionId: 's1', kind: 'tool_result', ts: Date.now(), raw: {}, toolName: 'Read' },
    ];
    const state = createSessionState('s1', '/tmp/t.jsonl');

    const digest = await liveDigest(batch, state, client);
    expect(digest.filesInFocus).toEqual([]);
    expect(digest.openQuestions).toEqual([]);
    expect(digest.significantEvent).toBe(false);
  });
});

describe('SessionState', () => {
  it('creates initial state', () => {
    const state = createSessionState('s1', '/tmp/t.jsonl');
    expect(state.sessionId).toBe('s1');
    expect(state.turnCount).toBe(0);
    expect(state.recentDigests).toEqual([]);
  });

  it('updates state with digest', () => {
    let state = createSessionState('s1', '/tmp/t.jsonl');
    const digest = {
      summary: 'Added function',
      currentIntent: 'Writing tests',
      filesInFocus: ['src/utils.ts'],
      openQuestions: ['Which test framework?'],
      significantEvent: true,
    };

    state = updateSessionState(state, digest);
    expect(state.turnCount).toBe(1);
    expect(state.currentIntent).toBe('Writing tests');
    expect(state.intentHistory).toContain('Writing tests');
    expect(state.filesInFocus).toContain('src/utils.ts');
    expect(state.significantEvents).toContain('Added function');
    expect(state.recentDigests).toHaveLength(1);
  });

  it('keeps sliding window of 5 recent digests', () => {
    let state = createSessionState('s1', '/tmp/t.jsonl');
    for (let i = 0; i < 7; i++) {
      state = updateSessionState(state, {
        summary: `Digest ${i}`,
        currentIntent: `intent-${i}`,
        filesInFocus: [],
        openQuestions: [],
        significantEvent: false,
      });
    }
    expect(state.recentDigests).toHaveLength(5);
    expect(state.recentDigests[0].summary).toBe('Digest 2'); // oldest kept
  });
});
