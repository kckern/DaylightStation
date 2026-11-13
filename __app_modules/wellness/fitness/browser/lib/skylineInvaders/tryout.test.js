import { describe, expect, it } from 'vitest';
import { TRYOUT_TARGETS, advanceTryout, createTryout, tryoutSummary, tryoutTargets } from './tryout.js';

const feed = (tryout, steps) => steps.reduce((state, [lane, at]) => advanceTryout(state, lane, at), tryout);

describe('controls tryout', () => {
  it('sets the same three targets for every gesture: left edge, middle pair, right edge', () => {
    expect(TRYOUT_TARGETS.map((target) => [target.id, [...target.lanes]])).toEqual([['left', [0]], ['centre', [3, 4]], ['right', [7]]]);
  });
  it('lights a target while the cannon is under it', () => {
    const on = feed(createTryout('wiper', 1000), [[2, 1000], [0, 1100]]);
    expect(tryoutTargets(on).map((target) => target.lit)).toEqual([true, false, false]);
    expect(tryoutTargets(advanceTryout(on, 2, 1200)).some((target) => target.lit)).toBe(false);
    expect(tryoutTargets(advanceTryout(on, 4, 1200)).map((target) => target.lit)).toEqual([false, true, false]);
  });
  it('counts a target as reached after the cannon has rested on it, timed from when it arrived', () => {
    let tryout = feed(createTryout('twist', 1000), [[3, 1000], [1, 2000], [0, 2500], [0, 2800]]);
    expect(tryout.reached).toEqual({});                      // 300 ms on the left target: not yet
    tryout = advanceTryout(tryout, 0, 2900);
    expect(tryout.reached).toEqual({ left: 1500 });           // arrived 1.5 s after the card opened
    expect(tryoutTargets(tryout)[0]).toMatchObject({ lit: true, reached: true });
  });
  it('passing through a target without stopping does not count, and is a visit', () => {
    const tryout = feed(createTryout('push', 0), [[2, 0], [3, 100], [5, 200], [4, 300], [2, 350], [3, 400], [3, 900]]);
    expect(tryout.reached).toEqual({ centre: 400 });
    expect(tryout.visits.centre).toBe(3);
  });
  it('moving between the two middle lanes stays on the centre target', () => {
    const tryout = feed(createTryout('hop', 0), [[1, 0], [3, 100], [4, 300], [3, 520]]);
    expect(tryout.reached).toEqual({ centre: 100 });
    expect(tryout.visits.centre).toBe(1);
  });
  it('keeps the first time a target was reached', () => {
    const tryout = feed(createTryout('wings', 0), [[4, 0], [7, 100], [7, 600], [5, 700], [7, 900], [7, 1500]]);
    expect(tryout.reached).toEqual({ right: 100 });
  });
  it('standing on the centre target when the card opens does not count: the cannon has to leave and come back', () => {
    let tryout = feed(createTryout('wiper', 0), [[4, 0], [4, 2000]]);
    expect(tryout.reached).toEqual({});
    expect(tryoutTargets(tryout)[1]).toMatchObject({ lit: true, reached: false });
    tryout = feed(tryout, [[6, 2100], [4, 2600], [4, 3100]]);
    expect(tryout.reached).toEqual({ centre: 2600 });
  });
  it('summarizes a card for the log', () => {
    const tryout = feed(createTryout('drag', 1000), [[3, 1000], [3, 1500], [0, 4000], [0, 4500], [2, 6000], [3, 7000], [3, 7500]]);
    expect(tryoutSummary(tryout, 9000, 'step')).toEqual({
      gesture: 'drag', how: 'step', ms: 8000, reached: 2, leftMs: 3000, centreMs: 6000, rightMs: null,
      visits: { centre: 1, left: 1 }, laneChanges: 3,
    });
  });
});
