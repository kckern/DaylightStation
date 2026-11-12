import { describe, it, expect } from 'vitest';
import { createFrameMeter, createPoseMeter } from './poseMetrics.js';

describe('pose meter', () => {
  it('reports fps as frames delivered over the span', () => {
    const m = createPoseMeter();
    for (let i = 0; i < 300; i += 1) m.add(i * (1000 / 30), 20, true); // 10 s at 30 fps
    const r = m.result(0, 10000);
    expect(r.frames).toBe(300);
    expect(r.fps).toBe(30);
    expect(r.minWindowFps).toBe(30);
    expect(r.meetsGate).toBe(true);
    expect(r.latencyMs.p50).toBe(20);
    expect(r.intervalMs.p50).toBeCloseTo(33.3, 1);
  });

  it('counts a stall against fps and the worst window', () => {
    const m = createPoseMeter();
    for (let t = 0; t < 5000; t += 50) m.add(t, 30, true); // 20 fps for 5 s
    for (let t = 9000; t < 10000; t += 50) m.add(t, 30, true); // 4 s stall, then 1 s
    const r = m.result(0, 10000);
    expect(r.fps).toBe(12);
    expect(r.minWindowFps).toBe(4);
    expect(r.meetsGate).toBe(false);
    expect(r.intervalMs.max).toBe(4050);
  });

  it('takes latency percentiles from the samples inside the span only', () => {
    const m = createPoseMeter();
    m.add(-10, 500, true);
    [10, 20, 30, 40, 100].forEach((lat, i) => m.add(i * 100, lat, true));
    const r = m.result(0, 1000);
    expect(r.latencyMs).toMatchObject({ n: 5, p50: 30, p95: 88, max: 100 });
  });

  it('gives a trailing-window live reading', () => {
    const m = createPoseMeter();
    for (let t = 0; t < 3000; t += 40) m.add(t, t < 2000 ? 10 : 50, t >= 1500);
    expect(m.live(3000, 1000)).toEqual({ fps: 24, latencyP50: 50, latencyP95: 50 }) // window is (t - 1000, t];
    expect(m.posePct()).toBe(49.3); // 37 of 75 samples
  });

  it('handles an empty span', () => {
    const r = createPoseMeter().result(0, 1000);
    expect(r.frames).toBe(0);
    expect(r.fps).toBe(0);
    expect(r.latencyMs.n).toBe(0);
    expect(r.minWindowFps).toBeNull();
  });
});

describe('frame meter', () => {
  it('measures a render loop', () => {
    const m = createFrameMeter();
    for (let t = 0; t <= 2000; t += 20) m.add(t);
    const r = m.result(0, 2000);
    expect(r.fps).toBe(50.5);
    expect(r.frameMs.p95).toBe(20);
    expect(m.live(2000, 1000)).toBe(50);
    m.trim(2000, 500);
    expect(m.result(0, 2000).frames).toBe(26);
  });
});
