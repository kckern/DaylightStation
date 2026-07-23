import { describe, it, expect, beforeEach } from 'vitest';
import { __resetRecorder, record, __snapshotForTest, CAPACITY } from './inputRecorder.js';

describe('inputRecorder ring buffer', () => {
  beforeEach(() => __resetRecorder());
  it('records a single event into the ring', () => {
    record(1, 72, 88, 112, 0);
    const snap = __snapshotForTest();
    expect(snap.count).toBe(1);
    expect(snap.dropped).toBe(0);
    expect(snap.records[0]).toMatchObject({ kind: 1, a: 72, b: 88, c: 112, d: 0 });
    expect(typeof snap.records[0].t).toBe('number');
  });
  it('wraps at CAPACITY and counts drops without throwing', () => {
    for (let i = 0; i < CAPACITY + 5; i++) record(5, i, 0, 0, 0);
    const snap = __snapshotForTest();
    expect(snap.dropped).toBe(5);
    expect(snap.records[snap.records.length - 1].a).toBe(CAPACITY + 4);
  });
});

import { intern, __internTableForTest } from './inputRecorder.js';
describe('string intern table', () => {
  beforeEach(() => __resetRecorder());
  it('returns stable ids and is idempotent', () => {
    const a1 = intern('loop-toggle');
    const a2 = intern('loop-toggle');
    const b1 = intern('tempo-');
    expect(a1).toBe(a2);
    expect(b1).not.toBe(a1);
    expect(__internTableForTest()[a1]).toBe('loop-toggle');
  });
});
