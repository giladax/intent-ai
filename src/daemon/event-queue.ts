import type { ObservedEvent } from './types.js';

type FlushCallback = (batch: ObservedEvent[]) => void;

export class EventQueue {
  private buffer: ObservedEvent[] = [];
  private quietMs: number;
  private maxBatch: number;
  private onFlush: FlushCallback;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(onFlush: FlushCallback, opts?: { quietMs?: number; maxBatch?: number }) {
    this.onFlush = onFlush;
    this.quietMs = opts?.quietMs ?? 3000;
    this.maxBatch = opts?.maxBatch ?? 10;
  }

  push(evt: ObservedEvent): void {
    this.buffer.push(evt);

    // If buffer hits maxBatch, flush immediately
    if (this.buffer.length >= this.maxBatch) {
      this.doFlush();
      return;
    }

    // Reset quiet timer
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.doFlush(), this.quietMs);
  }

  flush(): void {
    this.doFlush();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private doFlush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;

    if (this.buffer.length === 0) return;

    const batch = this.buffer.splice(0);
    this.onFlush(batch);
  }
}
