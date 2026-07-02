import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTickLerp } from './motionClock.js';

// Fake rAF: a manual frame queue driven by a controllable clock, so we can assert
// the exact linear fraction the loop reports at chosen timestamps.
describe('createTickLerp (motion clock)', () => {
  let frames;
  let seq;
  let nowMs;

  beforeEach(() => {
    frames = new Map();
    seq = 0;
    nowMs = 0;
    vi.stubGlobal('requestAnimationFrame', (cb) => { seq += 1; frames.set(seq, cb); return seq; });
    vi.stubGlobal('cancelAnimationFrame', (id) => { frames.delete(id); });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  // Run every currently-queued frame once (frames scheduled during the flush run on
  // the NEXT flush, mirroring a real rAF turn).
  const flush = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((cb) => cb(nowMs));
  };

  const makeClock = (intervalMs = 1000) => createTickLerp({ intervalMs, now: () => nowMs });

  it('reports a LINEAR fraction 0→1 across the interval', () => {
    const clock = makeClock(1000);
    const seen = [];
    clock.subscribe((f) => seen.push(f));

    nowMs = 0; clock.onTick();     // arm at t=0
    nowMs = 0; flush();            // f = 0
    nowMs = 250; flush();          // f = 0.25
    nowMs = 500; flush();          // f = 0.5
    nowMs = 1000; flush();         // f = 1 (parks)

    expect(seen[0]).toBe(0);
    expect(seen[1]).toBeCloseTo(0.25, 6);
    expect(seen[2]).toBeCloseTo(0.5, 6);
    expect(seen[3]).toBe(1);
    // No easing: the midpoint fraction is exactly 0.5, not eased.
    expect(seen[2]).toBe(0.5);
  });

  it('parks at fraction 1 and re-arms on the next onTick', () => {
    const clock = makeClock(1000);
    const seen = [];
    clock.subscribe((f) => seen.push(f));

    nowMs = 0; clock.onTick();
    nowMs = 1000; flush();         // saturates → parks
    expect(clock.running).toBe(false);
    seen.length = 0;

    // A stale frame after parking does nothing.
    flush();
    expect(seen).toEqual([]);

    // Next tick re-arms from 0.
    nowMs = 1000; clock.onTick();
    nowMs = 1000; flush();
    expect(seen[0]).toBe(0);
    expect(clock.running).toBe(true);
  });

  it('passes the tick payload through to subscribers unchanged', () => {
    const clock = makeClock(1000);
    const seen = [];
    clock.subscribe((f, p) => seen.push(p));

    const payload = { riders: ['a', 'b'], tag: 42 };
    nowMs = 0; clock.onTick(payload);
    nowMs = 500; flush();

    expect(seen[0]).toBe(payload);
    expect(seen[0].tag).toBe(42);
  });

  it('stop() cancels the loop and drops subscribers', () => {
    const clock = makeClock(1000);
    const cb = vi.fn();
    clock.subscribe(cb);

    nowMs = 0; clock.onTick();     // schedules a frame
    clock.stop();                  // cancels it + clears subs
    nowMs = 500; flush();          // nothing queued / no subs

    expect(cb).not.toHaveBeenCalled();
    expect(clock.running).toBe(false);
  });

  it('unsubscribe removes a single subscriber without stopping others', () => {
    const clock = makeClock(1000);
    const a = vi.fn();
    const b = vi.fn();
    const offA = clock.subscribe(a);
    clock.subscribe(b);

    nowMs = 0; clock.onTick();
    nowMs = 500; flush();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    offA();
    nowMs = 750; flush();
    expect(a).toHaveBeenCalledTimes(1); // unchanged
    expect(b).toHaveBeenCalledTimes(2);
  });

  it('lands subscribers on the current tick (fraction 1) when rAF is unavailable', () => {
    vi.stubGlobal('requestAnimationFrame', undefined);
    const clock = makeClock(1000);
    const seen = [];
    clock.subscribe((f) => seen.push(f));

    nowMs = 0; clock.onTick();     // no rAF → emit(1) synchronously
    expect(seen).toEqual([1]);
    expect(clock.running).toBe(false);
  });
});
