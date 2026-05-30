import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventQueue } from '../../src/daemon/event-queue.js';
import type { ObservedEvent } from '../../src/daemon/types.js';

describe('EventQueue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function makeEvent(kind: string): ObservedEvent {
    return { source: 'hook', sessionId: 's1', kind, ts: Date.now(), raw: {} };
  }

  it('flushes when maxBatch reached', () => {
    const batches: ObservedEvent[][] = [];
    const q = new EventQueue((b) => batches.push(b), { maxBatch: 3, quietMs: 5000 });

    q.push(makeEvent('a'));
    q.push(makeEvent('b'));
    expect(batches).toHaveLength(0);

    q.push(makeEvent('c'));
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(3);
  });

  it('flushes after quiet period', () => {
    const batches: ObservedEvent[][] = [];
    const q = new EventQueue((b) => batches.push(b), { quietMs: 3000, maxBatch: 100 });

    q.push(makeEvent('a'));
    q.push(makeEvent('b'));
    expect(batches).toHaveLength(0);

    vi.advanceTimersByTime(3001);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
  });

  it('resets quiet timer on new push', () => {
    const batches: ObservedEvent[][] = [];
    const q = new EventQueue((b) => batches.push(b), { quietMs: 3000, maxBatch: 100 });

    q.push(makeEvent('a'));
    vi.advanceTimersByTime(2000);
    q.push(makeEvent('b'));
    vi.advanceTimersByTime(2000);
    expect(batches).toHaveLength(0);

    vi.advanceTimersByTime(1001);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
  });

  it('manual flush drains buffer', () => {
    const batches: ObservedEvent[][] = [];
    const q = new EventQueue((b) => batches.push(b));

    q.push(makeEvent('a'));
    q.flush();
    expect(batches).toHaveLength(1);
  });

  it('does not flush empty buffer', () => {
    const batches: ObservedEvent[][] = [];
    const q = new EventQueue((b) => batches.push(b));
    q.flush();
    expect(batches).toHaveLength(0);
  });
});
