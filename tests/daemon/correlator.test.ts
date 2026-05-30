import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Correlator } from '../../src/daemon/correlator.js';
import type { ObservedEvent } from '../../src/daemon/types.js';

function makeEvent(overrides: Partial<ObservedEvent>): ObservedEvent {
  return {
    source: 'hook',
    sessionId: 'sess-1',
    kind: 'tool_result',
    ts: Date.now(),
    raw: { some: 'data' },
    ...overrides,
  };
}

describe('Correlator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('deduplicates matching tool events from hook and jsonl', () => {
    const callback = vi.fn();
    const correlator = new Correlator(callback);

    const hookEvt = makeEvent({
      source: 'hook',
      toolUseId: 'tu-001',
      kind: 'tool_result',
      raw: { hook: 'payload' },
    });
    const jsonlEvt = makeEvent({
      source: 'jsonl',
      toolUseId: 'tu-001',
      kind: 'tool_call',
      raw: { jsonl: 'payload' },
    });

    correlator.ingest(hookEvt);
    correlator.ingest(jsonlEvt);

    expect(callback).toHaveBeenCalledTimes(1);

    const merged = callback.mock.calls[0][0] as ObservedEvent;
    // Hook is authoritative — its fields are the base
    expect(merged.source).toBe('hook');
    expect(merged.kind).toBe('tool_result');
    // Raw preserves both
    expect(merged.raw).toEqual({
      hook: { hook: 'payload' },
      jsonl: { jsonl: 'payload' },
    });

    correlator.stop();
  });

  it('emits events without toolUseId immediately', () => {
    const callback = vi.fn();
    const correlator = new Correlator(callback);

    const evt = makeEvent({
      kind: 'user_prompt',
      prompt: 'hello',
      toolUseId: undefined,
    });

    correlator.ingest(evt);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(evt);

    correlator.stop();
  });

  it('emits unmatched events after window expires', () => {
    const callback = vi.fn();
    const correlator = new Correlator(callback);

    const hookEvt = makeEvent({
      source: 'hook',
      toolUseId: 'tu-002',
      kind: 'tool_result',
    });

    correlator.ingest(hookEvt);
    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5001);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(hookEvt);
  });

  it('flush emits all pending events', () => {
    const callback = vi.fn();
    const correlator = new Correlator(callback);

    const hookEvt = makeEvent({
      source: 'hook',
      toolUseId: 'tu-003',
      kind: 'tool_result',
    });

    correlator.ingest(hookEvt);
    expect(callback).not.toHaveBeenCalled();

    correlator.flush();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(hookEvt);
  });
});
