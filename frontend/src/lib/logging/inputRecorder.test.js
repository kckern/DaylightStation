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

import { KIND, encodeBatch, buildHeader } from './inputRecorder.js';
describe('encode', () => {
  beforeEach(() => __resetRecorder());
  it('drains records into a numeric batch and clears drop count', () => {
    record(KIND.MIDI_ON, 72, 88, 112, 0);
    record(KIND.MIDI_OFF, 72, 0, 0, 0);
    const batch = encodeBatch();
    expect(batch.b).toHaveLength(2);
    expect(batch.b[0].slice(1)).toEqual([KIND.MIDI_ON, 72, 88, 112, 0]);
    expect(batch.dropped).toBe(0);
    expect(encodeBatch().b).toHaveLength(0);
  });
  it('header maps kind ids to names and includes interned strings', () => {
    intern('loop-toggle');
    const h = buildHeader({ session: 's1', score: 'x.mxl', ctx: {} });
    expect(h.kinds[String(KIND.MIDI_ON)]).toBe('midi.on');
    expect(h.strings).toContain('loop-toggle');
    expect(h.h).toBe(1);
  });
  it('header carries a t0 perf/wall anchor', () => {
    __resetRecorder();
    const h = buildHeader({ session: 's', score: 'x', ctx: { user: 'u' } });
    expect(h.ctx.user).toBe('u');
    expect(typeof h.ctx.t0.perf).toBe('number');
    expect(typeof h.ctx.t0.wall).toBe('number');
  });
});

import { record as recordFn } from './inputRecorder.js';
describe('hot-path allocation guard', () => {
  it('record() source contains no allocating constructs', () => {
    const src = recordFn.toString();
    expect(src).not.toMatch(/JSON\./);
    expect(src).not.toMatch(/\bnew\s/);
    expect(src).not.toMatch(/\.push\(/);
    // Object/array literals appear after =, (, comma, or return — but bare
    // typed-array indexing (t[i]) legitimately uses `[`, so anchor on those.
    expect(src).not.toMatch(/[=(,]\s*[[{]/);
  });
});

import { startRecorder, stopRecorder } from './inputRecorder.js';
import { vi } from 'vitest';
describe('drain lifecycle', () => {
  beforeEach(() => __resetRecorder());
  it('sends header once, then flushes batches, then a final flush on stop', () => {
    vi.useFakeTimers();
    const sent = [];
    startRecorder({ session: 's1', score: 'x.mxl', ctx: {}, send: (m) => sent.push(m), flushMs: 1000 });
    expect(sent[0].h).toBe(1);
    record(KIND.TAP, 1, 2, 0, 0);
    vi.advanceTimersByTime(1000);
    expect(sent[1].b).toHaveLength(1);
    record(KIND.TAP, 3, 4, 0, 0);
    stopRecorder();
    expect(sent[sent.length - 1].b).toHaveLength(1);
    vi.useRealTimers();
  });
  it('does not throw when an idle tick fires after stop', () => {
    vi.useFakeTimers();
    let cb; globalThis.requestIdleCallback = (fn) => { cb = fn; }; // capture, don't run
    startRecorder({ session: 's', score: 'x', ctx: {}, send: () => {}, flushMs: 1000 });
    record(KIND.TAP, 1, 0, 0, 0);
    vi.advanceTimersByTime(1000); // schedules the idle cb (captured, not run)
    stopRecorder();               // nulls sendFn
    record(KIND.RENDER, 0, 1, 0, 0); // always-on recording continues -> ring non-empty
    expect(() => cb && cb()).not.toThrow(); // the deferred tick must be safe
    delete globalThis.requestIdleCallback; vi.useRealTimers();
  });
  it('does not send an empty batch', () => {
    vi.useFakeTimers();
    const sent = [];
    startRecorder({ session: 's1', score: 'x.mxl', ctx: {}, send: (m) => sent.push(m), flushMs: 1000 });
    vi.advanceTimersByTime(3000);
    expect(sent.filter((m) => Array.isArray(m.b) && m.b.length === 0)).toHaveLength(0);
    stopRecorder();
    vi.useRealTimers();
  });
});
