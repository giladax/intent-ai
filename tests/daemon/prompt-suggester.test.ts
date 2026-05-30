import { describe, it, expect, vi } from 'vitest';
import { suggestPrompts } from '../../src/daemon/prompt-suggester.js';
import type { SessionState } from '../../src/daemon/types.js';

function mockClient(responseText: string) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: responseText }],
      }),
    },
  } as any;
}

function makeState(overrides?: Partial<SessionState>): SessionState {
  return {
    sessionId: 's1',
    startedAt: Date.now(),
    transcriptPath: '/tmp/t.jsonl',
    turnCount: 3,
    currentIntent: 'Adding tests',
    intentHistory: ['Setup project', 'Add feature', 'Adding tests'],
    filesInFocus: ['src/utils.ts', 'tests/utils.test.ts'],
    toolsUsed: { Read: 5, Write: 2, Bash: 1 },
    recentDigests: [{ summary: 'Added test file', currentIntent: 'Adding tests', filesInFocus: ['tests/utils.test.ts'], openQuestions: [], significantEvent: false }],
    openQuestions: ['Should we use vitest or jest?'],
    significantEvents: ['Completed feature implementation'],
    latestSuggestion: null,
    ...overrides,
  };
}

describe('suggestPrompts', () => {
  it('returns valid suggestions from LLM response', async () => {
    const client = mockClient(JSON.stringify({
      suggestions: [
        { prompt: 'Run the tests and fix any failures', reasoning: 'Tests were just written', category: 'verify' },
        { prompt: 'Add error handling to the hello function', reasoning: 'No edge cases covered', category: 'refine' },
      ],
      sessionSummary: 'Feature implemented, tests written, ready to verify',
    }));

    const result = await suggestPrompts(makeState(), client);
    expect(result.suggestions).toHaveLength(2);
    expect(result.suggestions[0].category).toBe('verify');
    expect(result.suggestions[1].category).toBe('refine');
    expect(result.sessionSummary).toContain('verify');
    expect(result.updatedAt).toBeGreaterThan(0);
  });

  it('handles markdown-fenced response', async () => {
    const client = mockClient('```json\n{"suggestions":[{"prompt":"test","reasoning":"reason","category":"continue"}],"sessionSummary":"summary"}\n```');
    const result = await suggestPrompts(makeState(), client);
    expect(result.suggestions).toHaveLength(1);
  });

  it('applies defaults for missing optional fields', async () => {
    const client = mockClient('{}');
    const result = await suggestPrompts(makeState(), client);
    expect(result.suggestions).toEqual([]);
    expect(result.sessionSummary).toBe('');
    expect(result.updatedAt).toBeGreaterThan(0);
  });

  it('includes tools used in prompt context', async () => {
    const client = mockClient(JSON.stringify({
      suggestions: [{ prompt: 'test', reasoning: 'r', category: 'continue' }],
      sessionSummary: 's',
    }));
    const state = makeState({ toolsUsed: { Read: 10, Edit: 3 } });
    await suggestPrompts(state, client);

    // Verify the prompt sent to LLM included tools
    const call = client.messages.create.mock.calls[0][0];
    const promptText = call.messages[0].content;
    expect(promptText).toContain('Read(10)');
    expect(promptText).toContain('Edit(3)');
  });
});
