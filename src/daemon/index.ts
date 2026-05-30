/**
 * Daemon entry point — wires all observe channel modules together.
 *
 * Flow: HookServer + TailWatcher → Normalizer → Correlator → EventQueue + Sink → LiveDigest → SessionState → PromptSuggester
 */

import Anthropic from '@anthropic-ai/sdk';
import { HookServer } from './hook-server.js';
import { TailWatcher } from './tail-watcher.js';
import { normalizeHook, normalizeJsonlLine } from './normalizer.js';
import { Correlator } from './correlator.js';
import { EventQueue } from './event-queue.js';
import { liveDigest } from './live-digest.js';
import { createSessionState, updateSessionState } from './session-state.js';
import { suggestPrompts } from './prompt-suggester.js';
import { FileSink } from './sink.js';
import type { ObservedEvent, SessionState, PromptSuggestion } from './types.js';

export async function startDaemon(port = 4317): Promise<void> {
  const client = new Anthropic();
  const sink = new FileSink('events.ndjson');

  let sessionState: SessionState | null = null;
  let latestSuggestion: PromptSuggestion | null = null;
  let tailWatcher: TailWatcher | null = null;
  let batchCount = 0;

  // Event queue → live digest → session state → prompt suggester
  const queue = new EventQueue(async (batch) => {
    // Always sink events
    // Then if we have session state, run live digest
    if (!sessionState) return;

    try {
      const digest = await liveDigest(batch, sessionState, client);
      sessionState = updateSessionState(sessionState, digest);

      batchCount++;
      console.log(`[digest] ${digest.summary} (significant: ${digest.significantEvent})`);

      // Track tools from batch
      for (const evt of batch) {
        if (evt.toolName) {
          sessionState.toolsUsed[evt.toolName] = (sessionState.toolsUsed[evt.toolName] || 0) + 1;
        }
      }

      // Suggest prompts if significant or every 3rd batch
      if (digest.significantEvent || batchCount % 3 === 0) {
        try {
          latestSuggestion = await suggestPrompts(sessionState, client);
          sessionState.latestSuggestion = latestSuggestion;
          console.log(`[suggest] ${latestSuggestion.suggestions.length} suggestions`);
          for (const s of latestSuggestion.suggestions) {
            console.log(`  [${s.category}] ${s.prompt.slice(0, 80)}`);
          }
        } catch (err) {
          console.warn(`[suggest] Error: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } catch (err) {
      console.warn(`[digest] Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, { quietMs: 3000, maxBatch: 10 });

  // Correlator → event queue + sink
  const correlator = new Correlator((evt) => {
    sink.ingest(evt);
    queue.push(evt);
  });

  // Handle incoming events from both sources
  const handleEvent = (evt: ObservedEvent) => {
    correlator.ingest(evt);
  };

  // Hook server
  const server = new HookServer({
    port,
    onHook: (body) => {
      const evt = normalizeHook(body);
      handleEvent(evt);

      // Initialize session state on first event
      if (!sessionState && evt.sessionId) {
        sessionState = createSessionState(evt.sessionId, evt.transcriptPath ?? '');
        console.log(`[session] Started: ${evt.sessionId}`);
      }

      // Start tail watcher on first transcript_path
      if (!tailWatcher && evt.transcriptPath) {
        console.log(`[tail] Following: ${evt.transcriptPath}`);
        tailWatcher = new TailWatcher(evt.transcriptPath, (line) => {
          const events = normalizeJsonlLine(line);
          for (const e of events) {
            handleEvent(e);
          }
        });
        tailWatcher.start().catch(err => {
          console.warn(`[tail] Error starting: ${err instanceof Error ? err.message : String(err)}`);
        });
      }

      // Track session end
      if (evt.kind === 'session_end') {
        console.log(`[session] Ended: ${evt.sessionId}`);
      }
    },
    getState: () => ({
      state: sessionState,
      suggestion: latestSuggestion,
    }),
  });

  await server.start();
  console.log(`[daemon] Listening on ${server.address}`);
  console.log(`[daemon] Waiting for Claude Code hooks...`);

  // Graceful shutdown
  const shutdown = async () => {
    console.log(`\n[daemon] Shutting down...`);
    queue.flush();
    correlator.flush();
    queue.stop();
    correlator.stop();
    tailWatcher?.stop();
    await server.stop();
    console.log(`[daemon] Done.`);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
