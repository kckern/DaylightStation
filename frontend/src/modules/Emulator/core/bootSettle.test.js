import { describe, it, expect, vi } from 'vitest';
import { waitForStarted, applyVerified, settleBoot } from './bootSettle.js';

/**
 * Deterministic clock + timer pair. Timers fire immediately but advance the fake
 * clock, so deadline logic is exercised without real waiting.
 */
function fakeTime(stepMs = 50) {
  let t = 0;
  return {
    now: () => t,
    setTimeoutFn: (fn) => { t += stepMs; fn(); },
    advance: (ms) => { t += ms; },
  };
}

describe('waitForStarted', () => {
  it('resolves immediately when already started', async () => {
    const clock = fakeTime();
    const res = await waitForStarted({ isStarted: () => true, ...clock });
    expect(res).toEqual({ started: true, waitedMs: 0 });
  });

  it('polls until started flips true', async () => {
    const clock = fakeTime();
    let calls = 0;
    const res = await waitForStarted({ isStarted: () => (++calls >= 4), ...clock });
    expect(res.started).toBe(true);
    expect(calls).toBe(4);
  });

  it('gives up at the deadline and degrades instead of hanging', async () => {
    const clock = fakeTime();
    const res = await waitForStarted({
      isStarted: () => false, deadlineMs: 200, pollMs: 50, ...clock,
    });
    expect(res.started).toBe(false);
    expect(res.waitedMs).toBeGreaterThanOrEqual(200);
  });

  it('treats a throwing probe as not-started rather than propagating', async () => {
    const clock = fakeTime();
    const res = await waitForStarted({
      isStarted: () => { throw new Error('instance gone'); },
      deadlineMs: 100, pollMs: 50, ...clock,
    });
    expect(res.started).toBe(false);
  });
});

describe('applyVerified', () => {
  it('applies once when the value sticks', () => {
    const apply = vi.fn();
    const res = applyVerified({ name: 'volume', apply, verify: () => true });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ name: 'volume', ok: true, reasserted: false, error: null });
  });

  it('re-asserts once when something clobbered us — the EJS volume bug', () => {
    // Models EJS's start chain overwriting our volume: the first verify fails,
    // the second (after re-apply) succeeds.
    let live = 0.5;
    let checks = 0;
    const res = applyVerified({
      name: 'volume',
      apply: () => { live = 0.1; },
      verify: () => { checks += 1; if (checks === 1) { live = 0.5; return false; } return live === 0.1; },
    });
    expect(res.ok).toBe(true);
    expect(res.reasserted).toBe(true);
  });

  it('reports failure when even the re-assert does not take', () => {
    const res = applyVerified({ name: 'gamepad', apply: () => {}, verify: () => false });
    expect(res).toEqual({ name: 'gamepad', ok: false, reasserted: true, error: null });
  });

  it('captures a throwing apply instead of blowing up the boot', () => {
    const res = applyVerified({
      name: 'tap', apply: () => { throw new Error('no simulateInput'); }, verify: () => true,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('no simulateInput');
  });
});

describe('settleBoot', () => {
  it('waits for the barrier before applying anything', async () => {
    const clock = fakeTime();
    const order = [];
    let started = false;
    let polls = 0;
    const promise = settleBoot({
      isStarted: () => { polls += 1; if (polls >= 3) started = true; return started; },
      settings: [{ name: 'vol', apply: () => order.push('apply'), verify: () => true }],
      ...clock,
    });
    const res = await promise;
    // apply must not have run before the third poll flipped started
    expect(polls).toBe(3);
    expect(order).toEqual(['apply']);
    expect(res.started).toBe(true);
  });

  it('summarises which settings drifted and which failed', async () => {
    const clock = fakeTime();
    let checks = 0;
    const res = await settleBoot({
      isStarted: () => true,
      settings: [
        { name: 'ok', apply: () => {}, verify: () => true },
        { name: 'drifted', apply: () => {}, verify: () => (++checks > 1) },
        { name: 'broken', apply: () => {}, verify: () => false },
      ],
      ...clock,
    });
    expect(res.reasserted).toEqual(['drifted', 'broken']);
    expect(res.failed).toEqual(['broken']);
    expect(res.results).toHaveLength(3);
  });

  it('still applies best-effort config when the barrier times out', async () => {
    const clock = fakeTime();
    const apply = vi.fn();
    const res = await settleBoot({
      isStarted: () => false,
      settings: [{ name: 'vol', apply, verify: () => true }],
      deadlineMs: 100, pollMs: 50, ...clock,
    });
    expect(res.started).toBe(false);
    expect(apply).toHaveBeenCalled(); // degrade, never brick
  });

  it('handles an empty settings list', async () => {
    const clock = fakeTime();
    const res = await settleBoot({ isStarted: () => true, ...clock });
    expect(res).toMatchObject({ started: true, results: [], reasserted: [], failed: [] });
  });
});
