import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createStaleSessionWatchdog } from './staleSessionWatchdog.js';

describe('createStaleSessionWatchdog', () => {
  beforeEach(() => vi.useFakeTimers({ now: 1000000 }));
  afterEach(() => vi.useRealTimers());

  it('does not escalate on a single dash.error', () => {
    const onEscalate = vi.fn();
    const wd = createStaleSessionWatchdog({ onEscalate, threshold: 3, windowMs: 10000 });
    wd.recordError({ code: 28, message: 'segment not available' });
    expect(onEscalate).not.toHaveBeenCalled();
  });

  it('does not escalate at threshold - 1', () => {
    const onEscalate = vi.fn();
    const wd = createStaleSessionWatchdog({ onEscalate, threshold: 3, windowMs: 10000 });
    wd.recordError({ code: 28 });
    vi.advanceTimersByTime(1000);
    wd.recordError({ code: 28 });
    expect(onEscalate).not.toHaveBeenCalled();
  });

  it('escalates when threshold errors hit within window', () => {
    const onEscalate = vi.fn();
    const wd = createStaleSessionWatchdog({ onEscalate, threshold: 3, windowMs: 10000 });
    wd.recordError({ code: 28, message: 'session/AAA not available' });
    vi.advanceTimersByTime(2000);
    wd.recordError({ code: 28, message: 'session/AAA not available' });
    vi.advanceTimersByTime(2000);
    wd.recordError({ code: 28, message: 'session/AAA not available' });
    expect(onEscalate).toHaveBeenCalledTimes(1);
    expect(onEscalate).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'stale-session-detected',
      errorCount: 3,
      windowMs: 10000
    }));
  });

  it('does not escalate if errors are outside the window', () => {
    const onEscalate = vi.fn();
    const wd = createStaleSessionWatchdog({ onEscalate, threshold: 3, windowMs: 10000 });
    wd.recordError({ code: 28 });
    vi.advanceTimersByTime(6000);
    wd.recordError({ code: 28 });
    vi.advanceTimersByTime(6000); // total 12s — first error fell off
    wd.recordError({ code: 28 });
    expect(onEscalate).not.toHaveBeenCalled();
  });

  it('ignores non-segment errors (code != 28)', () => {
    const onEscalate = vi.fn();
    const wd = createStaleSessionWatchdog({ onEscalate, threshold: 3, windowMs: 10000 });
    wd.recordError({ code: 10, message: 'manifest error' });
    wd.recordError({ code: 10, message: 'manifest error' });
    wd.recordError({ code: 10, message: 'manifest error' });
    expect(onEscalate).not.toHaveBeenCalled();
  });

  it('ignores errors with no code', () => {
    const onEscalate = vi.fn();
    const wd = createStaleSessionWatchdog({ onEscalate, threshold: 3, windowMs: 10000 });
    wd.recordError({});
    wd.recordError(null);
    wd.recordError(undefined);
    expect(onEscalate).not.toHaveBeenCalled();
  });

  it('does not double-escalate after threshold crossing (one-shot)', () => {
    const onEscalate = vi.fn();
    const wd = createStaleSessionWatchdog({ onEscalate, threshold: 3, windowMs: 10000 });
    for (let i = 0; i < 6; i++) {
      wd.recordError({ code: 28 });
      vi.advanceTimersByTime(1000);
    }
    expect(onEscalate).toHaveBeenCalledTimes(1);
  });

  it('re-arms after reset()', () => {
    const onEscalate = vi.fn();
    const wd = createStaleSessionWatchdog({ onEscalate, threshold: 3, windowMs: 10000 });
    for (let i = 0; i < 3; i++) wd.recordError({ code: 28 });
    expect(onEscalate).toHaveBeenCalledTimes(1);

    wd.reset();
    for (let i = 0; i < 3; i++) wd.recordError({ code: 28 });
    expect(onEscalate).toHaveBeenCalledTimes(2);
  });

  it('exposes hasEscalated state', () => {
    const wd = createStaleSessionWatchdog({ onEscalate: () => {}, threshold: 2, windowMs: 10000 });
    expect(wd.hasEscalated).toBe(false);
    wd.recordError({ code: 28 });
    expect(wd.hasEscalated).toBe(false);
    wd.recordError({ code: 28 });
    expect(wd.hasEscalated).toBe(true);
    wd.reset();
    expect(wd.hasEscalated).toBe(false);
  });

  it('handles missing onEscalate callback gracefully', () => {
    const wd = createStaleSessionWatchdog({ threshold: 2, windowMs: 10000 });
    expect(() => {
      wd.recordError({ code: 28 });
      wd.recordError({ code: 28 });
    }).not.toThrow();
    expect(wd.hasEscalated).toBe(true);
  });

  it('uses defaults: threshold=3, windowMs=10000 when not specified', () => {
    const onEscalate = vi.fn();
    const wd = createStaleSessionWatchdog({ onEscalate });
    wd.recordError({ code: 28 });
    wd.recordError({ code: 28 });
    wd.recordError({ code: 28 });
    expect(onEscalate).toHaveBeenCalledTimes(1);
  });
});
