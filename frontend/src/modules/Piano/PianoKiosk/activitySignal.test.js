import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { activitySignal } from './activitySignal.js';

describe('activitySignal', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); });
  afterEach(() => { vi.useRealTimers(); });

  it('bump advances lastActivityAt and notifies subscribers', () => {
    const cb = vi.fn();
    const unsub = activitySignal.subscribe(cb);
    vi.setSystemTime(1_005_000);
    activitySignal.bump();
    expect(activitySignal.lastActivityAt()).toBe(1_005_000);
    expect(cb).toHaveBeenCalledTimes(1);
    unsub();
    activitySignal.bump();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('a throwing listener does not break the notifier or starve other subscribers', () => {
    const bad = vi.fn(() => { throw new Error('boom'); });
    const good = vi.fn();
    const unsubBad = activitySignal.subscribe(bad);
    const unsubGood = activitySignal.subscribe(good);
    vi.setSystemTime(1_010_000);
    expect(() => activitySignal.bump()).not.toThrow();
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
    expect(activitySignal.lastActivityAt()).toBe(1_010_000);
    unsubBad();
    unsubGood();
  });
});
