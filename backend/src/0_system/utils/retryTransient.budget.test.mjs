/**
 * The retry budget and jitter added after a voice memo was lost (2026-09-04).
 *
 * The shipped policy spent its whole allowance in ~58s against an upstream
 * that was cutting connections at a suspiciously exact 15s. The fix is a
 * longer allowance that is still BOUNDED — "retry longer" and "retry forever"
 * are different things, and only one of them is acceptable inside a request.
 */
import { describe, it, expect, vi } from 'vitest';
import { retryTransient } from './retryTransient.mjs';

const transient = (code = 'ECONNRESET') => Object.assign(new Error('socket hang up'), { code });

/** A fake clock the retry loop reads, so budget behaviour is not wall-clock timing. */
function fakeClock(perAttemptMs) {
  let t = 0;
  return { now: () => t, advance: (ms) => { t += ms; }, spend: () => { t += perAttemptMs; } };
}

describe('retryTransient — the overall budget', () => {
  it('stops retrying once the budget is spent, even with attempts left', async () => {
    const clock = fakeClock(15_000);
    const attempts = [];
    const fn = vi.fn(async () => { attempts.push(clock.now()); clock.spend(); throw transient(); });
    const exhausted = [];
    // The sleeps are charged to the fake clock, never to the wall clock — a
    // test that actually waits 6s to prove a backoff is a test nobody reruns.
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout')
      .mockImplementation((cb, ms) => { clock.advance(ms); cb(); return 0; });

    try {
    await expect(retryTransient(fn, {
      maxAttempts: 99, baseDelay: 2000, maxElapsedMs: 40_000,
      now: clock.now,
      onRetry: () => {},
      onBudgetExhausted: (info) => exhausted.push(info),
    })).rejects.toThrow('socket hang up');
    } finally { timeoutSpy.mockRestore(); }

    // 15s + 2s = 17; 15s + 4s = 36; the next 8s step would cross 40s.
    expect(fn).toHaveBeenCalledTimes(3);
    expect(exhausted).toHaveLength(1);
    expect(exhausted[0].attempts).toBe(3);
  });

  it('the budget is checked BEFORE the sleep is paid for, not after', async () => {
    // A budget only enforced after sleeping overruns by a whole backoff step.
    const clock = fakeClock(1_000);
    const fn = vi.fn(async () => { clock.spend(); throw transient(); });
    await expect(retryTransient(fn, {
      maxAttempts: 99, baseDelay: 10_000, maxElapsedMs: 5_000, now: clock.now,
    })).rejects.toThrow();
    // First attempt costs 1s; a 10s sleep would blow a 5s budget, so it stops.
    expect(fn).toHaveBeenCalledTimes(1);
    expect(clock.now()).toBeLessThan(5_000);
  });

  it('no budget given: behaviour is exactly the attempt count, as before', async () => {
    const fn = vi.fn(async () => { throw transient(); });
    await expect(retryTransient(fn, { maxAttempts: 3, baseDelay: 0 })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('a NON-transient error is not retried, budget or no budget', async () => {
    const fn = vi.fn(async () => { throw new Error('bad request'); });
    await expect(retryTransient(fn, { maxAttempts: 5, baseDelay: 0, maxElapsedMs: 60_000 }))
      .rejects.toThrow('bad request');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('a success on a later attempt still returns normally', async () => {
    let n = 0;
    const fn = vi.fn(async () => { if (++n < 3) throw transient(); return 'transcript'; });
    await expect(retryTransient(fn, { maxAttempts: 5, baseDelay: 0, maxElapsedMs: 60_000 }))
      .resolves.toBe('transcript');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe('retryTransient — jitter', () => {
  it('spreads the delay around the exponential step instead of retrying in lockstep', async () => {
    const seen = [];
    const originalRandom = Math.random;
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation((cb, ms) => { seen.push(ms); cb(); return 0; });
    try {
      for (const r of [0, 0.5, 1]) {
        Math.random = () => r;
        const fn = vi.fn(async () => { throw transient(); });
        await expect(retryTransient(fn, { maxAttempts: 2, baseDelay: 4000, jitter: 0.25 })).rejects.toThrow();
      }
    } finally {
      Math.random = originalRandom;
      timeoutSpy.mockRestore();
    }
    // 4000 * (1 -0.25 / 1 / 1+0.25)
    expect(seen).toEqual([3000, 4000, 5000]);
  });

  it('jitter 0 (the default) leaves the delay exactly exponential', async () => {
    const seen = [];
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation((cb, ms) => { seen.push(ms); cb(); return 0; });
    try {
      const fn = vi.fn(async () => { throw transient(); });
      await expect(retryTransient(fn, { maxAttempts: 4, baseDelay: 1000 })).rejects.toThrow();
    } finally { timeoutSpy.mockRestore(); }
    expect(seen).toEqual([1000, 2000, 4000]);
  });
});
