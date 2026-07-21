import { appendFileSync } from 'node:fs';
import type { DigestionSink, ObservedEvent } from './types.js';

/**
 * File-based sink that appends one JSON line per event to an NDJSON file.
 */
export class FileSink implements DigestionSink {
  private readonly path: string;

  constructor(outputPath: string = 'events.ndjson') {
    this.path = outputPath;
  }

  ingest(evt: ObservedEvent): void {
    const detail = evt.toolName || evt.prompt?.slice(0, 40) || '';
    console.log(`[${evt.source}] ${evt.kind} ${detail}`);
    appendFileSync(this.path, JSON.stringify(evt) + '\n', 'utf-8');
  }

  flush(): void {
    // No-op — writes are immediate via appendFileSync
  }
}
