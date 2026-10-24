import { describe, it, expect } from 'vitest';
import { summarizeFrameIntervals, createFrameTimingProbe } from './frameTimingProbe.js';

describe('summarizeFrameIntervals', () => {
  it('returns null for an empty window', () => {
    expect(summarizeFrameIntervals([])).toBeNull();
  });

  it('reports percentiles, max and long-frame counts', () => {
    const intervals = [...Array(96).fill(16.7), 40, 60, 120, 250];
    const s = summarizeFrameIntervals(intervals);
    expect(s.frames).toBe(100);
    expect(s.p50Ms).toBe(16.7);
    expect(s.p99Ms).toBe(120);
    expect(s.maxMs).toBe(250);
    expect(s.over50Ms).toBe(3);
    expect(s.over100Ms).toBe(2);
    expect(s.fps).toBeCloseTo(100 / ((96 * 16.7 + 40 + 60 + 120 + 250) / 1000), 0);
  });
});

describe('createFrameTimingProbe', () => {
  it('collects rAF intervals and event-loop lag, read() resets the window', () => {
    let t = 0;
    let rafCb = null;
    let tickCb = null;
    const probe = createFrameTimingProbe({
      now: () => t,
      raf: (cb) => { rafCb = cb; return 1; },
      caf: () => { rafCb = null; },
      setInterval: (cb) => { tickCb = cb; return 2; },
      clearInterval: () => { tickCb = null; },
      lagIntervalMs: 250,
    });
    probe.start();
    for (const dt of [0, 17, 16, 70]) { t += dt; rafCb(t); }
    t += 400; tickCb(); // 400ms since start-ish → lag measured against 250ms cadence
    const first = probe.read();
    expect(first.frames).toBe(3);
    expect(first.maxMs).toBe(70);
    expect(first.over50Ms).toBe(1);
    expect(first.loopLagMaxMs).toBeGreaterThan(0);
    expect(probe.read()).toBeNull();
    probe.stop();
    expect(rafCb).toBeNull();
    expect(tickCb).toBeNull();
  });
});
