/**
 * Correlator — deduplicates and merges events from hook and JSONL sources.
 *
 * When both sources emit an event for the same toolUseId, the hook event
 * is authoritative; the JSONL event's raw data is preserved alongside it.
 * Events without a toolUseId are emitted immediately (user prompts, etc.).
 * Unmatched events are emitted standalone after windowMs expires.
 */

import type { ObservedEvent } from './types.js';

type EventCallback = (evt: ObservedEvent) => void;

export class Correlator {
  private pending = new Map<string, { evt: ObservedEvent; timer: ReturnType<typeof setTimeout> }>();
  private windowMs: number;
  private onEvent: EventCallback;

  constructor(onEvent: EventCallback, windowMs = 5000) {
    this.onEvent = onEvent;
    this.windowMs = windowMs;
  }

  ingest(evt: ObservedEvent): void {
    const { toolUseId } = evt;

    // No toolUseId — emit immediately
    if (!toolUseId) {
      this.onEvent(evt);
      return;
    }

    const existing = this.pending.get(toolUseId);

    if (existing && existing.evt.source !== evt.source) {
      // We have a match from the other source — merge and emit
      clearTimeout(existing.timer);
      this.pending.delete(toolUseId);

      const merged = this.merge(existing.evt, evt);
      this.onEvent(merged);
    } else {
      // First occurrence (or same source duplicate) — park with timer
      if (existing) {
        clearTimeout(existing.timer);
      }

      const timer = setTimeout(() => {
        this.pending.delete(toolUseId);
        this.onEvent(evt);
      }, this.windowMs);

      this.pending.set(toolUseId, { evt, timer });
    }
  }

  flush(): void {
    for (const [id, { evt, timer }] of this.pending) {
      clearTimeout(timer);
      this.onEvent(evt);
    }
    this.pending.clear();
  }

  stop(): void {
    for (const { timer } of this.pending.values()) {
      clearTimeout(timer);
    }
    this.pending.clear();
  }

  /** Merge hook + JSONL events. Hook is authoritative for all fields. */
  private merge(a: ObservedEvent, b: ObservedEvent): ObservedEvent {
    const hookEvt = a.source === 'hook' ? a : b;
    const jsonlEvt = a.source === 'jsonl' ? a : b;

    return {
      ...hookEvt,
      raw: { hook: hookEvt.raw, jsonl: jsonlEvt.raw },
    };
  }
}
