import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { ObservedEvent, BatchDigest, SessionState } from './types.js';

const HAIKU_MODEL = 'claude-haiku-4-5';

const BatchDigestSchema = z.object({
  summary: z.string(),
  currentIntent: z.string(),
  filesInFocus: z.array(z.string()).optional().default([]),
  openQuestions: z.array(z.string()).optional().default([]),
  significantEvent: z.boolean().optional().default(false),
}).passthrough();

export async function liveDigest(
  batch: ObservedEvent[],
  state: SessionState,
  client: Anthropic,
): Promise<BatchDigest> {
  // Build a compact summary of the batch for the prompt
  const batchSummary = batch.map(evt => {
    if (evt.kind === 'user_prompt') return `User: ${(evt.prompt ?? '').slice(0, 200)}`;
    if (evt.kind === 'tool_call') return `Tool call: ${evt.toolName}`;
    if (evt.kind === 'tool_result') return `Tool result: ${evt.toolName ?? 'unknown'}`;
    if (evt.kind === 'assistant_text') return `Assistant text`;
    if (evt.kind === 'assistant_stop') return `Turn complete`;
    return `[${evt.kind}]`;
  }).join('\n');

  const stateContext = [
    `Turn: ${state.turnCount}`,
    `Current intent: ${state.currentIntent || 'unknown'}`,
    `Files: ${state.filesInFocus.join(', ') || 'none'}`,
    state.openQuestions.length > 0 ? `Open questions: ${state.openQuestions.join('; ')}` : '',
  ].filter(Boolean).join('\n');

  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: `You are observing a live Claude Code session. Analyze this batch of events and respond with JSON.

Current session state:
${stateContext}

New events:
${batchSummary}

Respond with a JSON object:
{
  "summary": "1-2 sentence description of what just happened",
  "currentIntent": "what the user/agent is trying to do now",
  "filesInFocus": ["active file paths"],
  "openQuestions": ["unresolved things"],
  "significantEvent": true/false (was this a pivot, error, completion, or notable moment?)
}

JSON only, no markdown fences.`,
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  // Try to extract JSON from the response (handle markdown fences)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch?.[0] ?? text);
  return BatchDigestSchema.parse(parsed);
}
