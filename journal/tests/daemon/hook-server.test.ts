import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { HookServer } from '../../src/daemon/hook-server.js';
import type { SessionState, PromptSuggestion } from '../../src/daemon/types.js';

describe('HookServer', () => {
  let server: HookServer;
  let port: number;
  let hookCalls: Record<string, unknown>[] = [];
  let mockState: SessionState | null = null;
  let mockSuggestion: PromptSuggestion | null = null;

  beforeAll(async () => {
    // Use a random high port to avoid conflicts
    port = 10_000 + Math.floor(Math.random() * 50_000);
    server = new HookServer({
      port,
      onHook: (body) => {
        hookCalls.push(body);
      },
      getState: () => ({ state: mockState, suggestion: mockSuggestion }),
    });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('POST /hooks returns 200 with empty body', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/hooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hook_event_name: 'SessionStart', session_id: 's1' }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe('');
  });

  it('POST /hooks calls onHook with parsed body', async () => {
    hookCalls = [];
    const payload = { hook_event_name: 'UserPromptSubmit', session_id: 's2', prompt: 'hello' };

    const hookReceived = new Promise<Record<string, unknown>>((resolve) => {
      const original = server['onHook'];
      server['onHook'] = (body) => {
        original(body);
        resolve(body);
        server['onHook'] = original;
      };
    });

    await fetch(`http://127.0.0.1:${port}/hooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const received = await hookReceived;
    expect(received).toEqual(payload);
    expect(hookCalls).toHaveLength(1);
    expect(hookCalls[0]).toEqual(payload);
  });

  it('GET /live returns session state', async () => {
    mockState = {
      sessionId: 'test-session',
      startedAt: Date.now(),
      transcriptPath: '/tmp/test.jsonl',
      turnCount: 5,
      currentIntent: 'refactoring pipeline',
      intentHistory: ['initial setup'],
      filesInFocus: ['src/index.ts'],
      toolsUsed: { Read: 3, Edit: 2 },
      recentDigests: [],
      openQuestions: ['what about tests?'],
      significantEvents: [],
      latestSuggestion: null,
    };
    mockSuggestion = {
      suggestions: [
        { prompt: 'Run the tests', reasoning: 'verify changes', category: 'verify' },
      ],
      sessionSummary: 'Refactoring the pipeline',
      updatedAt: Date.now(),
    };

    const res = await fetch(`http://127.0.0.1:${port}/live`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.state).toBeDefined();
    expect(data.state.sessionId).toBe('test-session');
    expect(data.state.turnCount).toBe(5);
    expect(data.suggestion).toBeDefined();
    expect(data.suggestion.suggestions).toHaveLength(1);
  });

  it('GET /health returns 200', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
  });

  it('returns CORS headers on GET /live', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/live`);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('handles OPTIONS preflight', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/hooks`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
  });

  it('returns 404 for unknown routes', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/unknown`);
    expect(res.status).toBe(404);
  });

  it('handles malformed JSON without crashing', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/hooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json{{{',
    });
    // Should still return 200 (responds before parsing)
    expect(res.status).toBe(200);

    // Server should still be alive
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    expect(health.status).toBe(200);
  });
});
