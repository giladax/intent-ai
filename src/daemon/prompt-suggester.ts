import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { SessionState, PromptSuggestion } from './types.js';

const HAIKU_MODEL = 'claude-haiku-4-5';

const SuggestionSchema = z.object({
  suggestions: z.array(z.object({
    prompt: z.string(),
    reasoning: z.string(),
    category: z.enum(['continue', 'refine', 'redirect', 'verify', 'explain']),
  })).default([]),
  sessionSummary: z.string().default(''),
}).passthrough();

export async function suggestPrompts(
  state: SessionState,
  client: Anthropic,
): Promise<PromptSuggestion> {
  const context = [
    `Session: ${state.sessionId}`,
    `Turns so far: ${state.turnCount}`,
    `Current intent: ${state.currentIntent || 'unclear'}`,
    state.intentHistory.length > 0 ? `Intent history: ${state.intentHistory.slice(-5).join(' → ')}` : '',
    state.filesInFocus.length > 0 ? `Active files: ${state.filesInFocus.join(', ')}` : '',
    state.openQuestions.length > 0 ? `Open questions: ${state.openQuestions.join('; ')}` : '',
    state.significantEvents.length > 0 ? `Key moments: ${state.significantEvents.slice(-3).join('; ')}` : '',
    state.recentDigests.length > 0 ? `Recent: ${state.recentDigests.slice(-2).map(d => d.summary).join('; ')}` : '',
  ].filter(Boolean).join('\n');

  const toolsSummary = Object.entries(state.toolsUsed)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5)
    .map(([name, count]) => `${name}(${count})`)
    .join(', ');

  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `You are a coding companion observing a live Claude Code session. Based on the current session state, suggest 2-3 prompts the user could give to Claude Code next.

Session state:
${context}
${toolsSummary ? `Tools used: ${toolsSummary}` : ''}

Each suggestion should be a concrete, ready-to-copy prompt. Categories:
- continue: keep going with current work
- refine: improve or fix what was just done
- redirect: shift focus to something else that needs attention
- verify: test or validate the work
- explain: understand what happened or why

Respond with JSON only (no markdown fences):
{
  "suggestions": [
    { "prompt": "the exact text to paste into Claude Code", "reasoning": "why this prompt (1 sentence)", "category": "continue|refine|redirect|verify|explain" }
  ],
  "sessionSummary": "1-line summary of where the session is now"
}`,
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch?.[0] ?? text);
  const validated = SuggestionSchema.parse(parsed);

  return {
    ...validated,
    updatedAt: Date.now(),
  };
}
