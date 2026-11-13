import { describe, expect, it } from 'vitest';
import { advanceSetupTest, createSetupTest, fireSetupTest, retrySetupTest, setupSecondsLeft, setupStepId, setupStepsView, setupTargets } from './setupTest.js';

const OPTS = { holdMs: 400, timeoutMs: 15000 };
// Feed the cannon's lane every 100 ms from `from` for `ms`.
const run = (test, lane, from, ms, lost = false) => {
  let t = test;
  for (let at = from; at <= from + ms; at += 100) t = advanceSetupTest(t, { lane, lost, at }, OPTS);
  return t;
};

describe('the test sweep', () => {
  it('passes left, right, then fire, each only when detected', () => {
    let t = createSetupTest('wheel', 0);
    t = run(t, 3, 0, 500);
    expect(setupStepId(t)).toBe('left');
    t = run(t, 0, 600, 500);
    expect(setupStepId(t)).toBe('right');
    expect(t.results.left).toBe(600);
    t = run(t, 7, 1200, 500);
    expect(setupStepId(t)).toBe('fire');
    // Fire is detected by the mat, never by the cannon's lane.
    t = run(t, 7, 1800, 2000);
    expect(t.status).toBe('running');
    t = fireSetupTest(t, 4000);
    expect(t.status).toBe('passed');
    expect(t.passedAt).toBe(4000);
    expect(setupStepsView(t).map((s) => s.state)).toEqual(['done', 'done', 'done']);
  });

  it('a cannon already parked on the edge has not gone there: it must arrive', () => {
    let t = createSetupTest('drag', 0);
    t = run(t, 0, 0, 2000);
    expect(setupStepId(t)).toBe('left');
    t = run(t, 1, 2100, 200);
    t = run(t, 0, 2400, 500);
    expect(setupStepId(t)).toBe('right');
  });

  it('a lost pose does not count, and a fire before its step is ignored', () => {
    let t = createSetupTest('wiper', 0);
    t = fireSetupTest(t, 50);
    expect(setupStepId(t)).toBe('left');
    t = run(t, 3, 0, 200);
    t = run(t, 0, 300, 1000, true);
    expect(setupStepId(t)).toBe('left');
  });

  it('times out a step nobody can do, and Try again restarts that step only', () => {
    let t = createSetupTest('twist', 0);
    t = run(t, 3, 0, 200);
    t = run(t, 0, 300, 500);
    t = run(t, 4, 900, 15000);
    expect(t.status).toBe('timeout');
    expect(setupStepsView(t).map((s) => s.state)).toEqual(['done', 'failed', 'todo']);
    expect(setupTargets(t).map((x) => x.lit)).toEqual([false, false]);
    // A timed-out test does not move.
    expect(advanceSetupTest(t, { lane: 7, at: 20000 }, OPTS)).toBe(t);
    t = retrySetupTest(t, 30000);
    expect(t).toMatchObject({ status: 'running', attempt: 2, stepStartedAt: 30000 });
    expect(setupStepId(t)).toBe('right');
    expect(setupSecondsLeft(t, 31000, OPTS)).toBe(14);
    t = run(t, 7, 30100, 500);
    expect(setupStepId(t)).toBe('fire');
  });

  it('a cannon resting on its edge when the clock runs out finishes its hold; after Try again one already there counts', () => {
    let t = createSetupTest('wiper', 0);
    t = run(t, 3, 0, 14500);
    t = run(t, 0, 14700, 200);          // arrives at 14.7 s
    expect(t.status).toBe('running');
    t = run(t, 0, 15000, 200);
    expect(setupStepId(t)).toBe('right');
    // Timed out short of the right edge, then the cannon gets there: Try again counts it from now.
    t = run(t, 5, 15300, 15100);
    expect(t.status).toBe('timeout');
    t = { ...t, lane: 7 };
    t = retrySetupTest(t, 40000);
    t = run(t, 7, 40100, 400);
    expect(setupStepId(t)).toBe('fire');
  });

  it('draws the edge targets: the step in hand lit, a done one reached', () => {
    let t = createSetupTest('wings', 0);
    expect(setupTargets(t)).toEqual([
      { id: 'left', lanes: [0], lit: true, reached: false },
      { id: 'right', lanes: [7], lit: false, reached: false },
    ]);
    t = run(t, 2, 0, 100);
    t = run(t, 0, 200, 500);
    expect(setupTargets(t).map((x) => [x.lit, x.reached])).toEqual([[false, true], [true, false]]);
  });
});
