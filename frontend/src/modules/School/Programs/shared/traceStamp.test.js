import { describe, expect, it } from 'vitest';
import { createTraceStamp, randomTraceId } from './traceStamp.js';

describe('createTraceStamp', () => {
  it('mints a 12-hex id unless one is given', () => {
    expect(randomTraceId()).toMatch(/^[0-9a-f]{12}$/);
    expect(createTraceStamp().id).toMatch(/^[0-9a-f]{12}$/);
    expect(createTraceStamp({ id: 'run-1' }).id).toBe('run-1');
  });

  it('stamps an order counter (named by orderKey), t since creation, and the context fields', () => {
    let now = 100;
    const s = createTraceStamp({ id: 'x', orderKey: 'traceSeq', fields: { learnerId: 'learner-a' }, now: () => now });
    now = 350;
    expect(s.stamp({ a: 1 })).toEqual({ a: 1, learnerId: 'learner-a', traceId: 'x', traceSeq: 1, t: 250 });
    expect(s.stamp({}).traceSeq).toBe(2);
  });

  it('by default the stamp wins over a colliding payload key', () => {
    const s = createTraceStamp({ id: 'x', fields: { mode: 'live' } });
    expect(s.stamp({ mode: 'intro', seq: 99 })).toMatchObject({ mode: 'live', seq: 1 });
  });

  it('overridable: context fields yield to the payload, the order fields never do', () => {
    const s = createTraceStamp({ id: 'x', orderKey: 'traceSeq', fields: { day: 8 }, overridable: true });
    expect(s.stamp({ day: 9, traceSeq: 50, seq: 16 })).toMatchObject({ day: 9, traceSeq: 1, seq: 16, traceId: 'x' });
  });

  it('set() changes what later events carry, not earlier ones', () => {
    const s = createTraceStamp({ id: 'x', fields: { day: null } });
    const before = s.stamp({});
    s.set({ day: 8 });
    expect(before.day).toBeNull();
    expect(s.stamp({}).day).toBe(8);
  });
});
