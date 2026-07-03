import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tweenScrollTo, cancelScrollTween } from './scrollTween.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
  vi.stubGlobal('requestAnimationFrame', (cb) => setTimeout(() => cb(Date.now()), 16));
  vi.stubGlobal('cancelAnimationFrame', (id) => clearTimeout(id));
  vi.setSystemTime(0);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const el = () => ({ scrollLeft: 0, scrollTop: 0 });

describe('tweenScrollTo', () => {
  it('reaches the target and stops', () => {
    const e = el();
    tweenScrollTo(e, { left: 300 }, { duration: 160 });
    vi.advanceTimersByTime(400);
    expect(Math.round(e.scrollLeft)).toBe(300);
  });
  it('RETARGETS an in-flight tween instead of restarting from a stale origin', () => {
    const e = el();
    tweenScrollTo(e, { left: 300 }, { duration: 160 });
    vi.advanceTimersByTime(64); // mid-flight
    const mid = e.scrollLeft;
    expect(mid).toBeGreaterThan(0);
    tweenScrollTo(e, { left: 600 }, { duration: 160 }); // new target, no jump back
    vi.advanceTimersByTime(16);
    expect(e.scrollLeft).toBeGreaterThanOrEqual(mid);
    vi.advanceTimersByTime(400);
    expect(Math.round(e.scrollLeft)).toBe(600);
  });
  it('cancelScrollTween halts motion', () => {
    const e = el();
    tweenScrollTo(e, { left: 300 }, { duration: 160 });
    vi.advanceTimersByTime(48);
    const at = e.scrollLeft;
    cancelScrollTween(e);
    vi.advanceTimersByTime(200);
    expect(e.scrollLeft).toBe(at);
  });
});
