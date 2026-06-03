import { describe, it, expect } from 'vitest';
import { deriveRaceSnapshot } from './deriveRaceSnapshot.js';

const rider = (over = {}) => ({
  cumulativeDistanceM: 0, lapSplits: [], isGhost: false, finishTimeS: null, ...over
});
const state = (riders, over = {}) => ({
  elapsedS: 10, winCondition: 'distance', goalM: 1000, timeCapS: 300,
  finished: false, riders, ...over
});

describe('deriveRaceSnapshot composition', () => {
  it('counts ghosts toward fieldSize; solo means one entity total', () => {
    const human = deriveRaceSnapshot(state({ a: rider() }), { lapLengthM: 0 }, null);
    expect(human.fieldSize).toBe(1);
    expect(human.isSolo).toBe(true);

    const withGhost = deriveRaceSnapshot(
      state({ a: rider(), g: rider({ isGhost: true }) }), { lapLengthM: 0 }, null);
    expect(withGhost.fieldSize).toBe(2);
    expect(withGhost.isSolo).toBe(false);
    expect(withGhost.ghostCount).toBe(1);
    expect(withGhost.humanCount).toBe(1);
  });

  it('lapsEnabled tracks config', () => {
    expect(deriveRaceSnapshot(state({ a: rider() }), { lapLengthM: 100 }, null).lapsEnabled).toBe(true);
    expect(deriveRaceSnapshot(state({ a: rider() }), { lapLengthM: 0 }, null).lapsEnabled).toBe(false);
  });
});

describe('deriveRaceSnapshot phase', () => {
  it('progresses PRE → EARLY → MID → FINALE → FINISHED with hysteresis', () => {
    const cfg = { lapLengthM: 0 };
    const at = (distM, prev, over = {}) =>
      deriveRaceSnapshot(state({ a: rider({ cumulativeDistanceM: distM }) }, over), cfg, prev);

    const pre = at(0, null, { elapsedS: 0 });
    expect(pre.phase).toBe('PRE');
    const early = at(50, pre); // 5% of 1000
    expect(early.phase).toBe('EARLY');
    const mid = at(500, early);
    expect(mid.phase).toBe('MID');
    const finale = at(900, mid); // 90%
    expect(finale.phase).toBe('FINALE');
    // hysteresis: dropping to 86% stays FINALE (exit band is < 80%)
    const stillFinale = at(860, finale);
    expect(stillFinale.phase).toBe('FINALE');
    const finished = at(1000, finale, { finished: true });
    expect(finished.phase).toBe('FINISHED');
  });
});

describe('deriveRaceSnapshot events', () => {
  it('fires LEAD_CHANGE on the edge only', () => {
    const cfg = { lapLengthM: 0 };
    const s1 = deriveRaceSnapshot(
      state({ a: rider({ cumulativeDistanceM: 100 }), b: rider({ cumulativeDistanceM: 50 }) }), cfg, null);
    expect(s1.leaderId).toBe('a');
    // b overtakes a
    const s2 = deriveRaceSnapshot(
      state({ a: rider({ cumulativeDistanceM: 100 }), b: rider({ cumulativeDistanceM: 200 }) }), cfg, s1);
    expect(s2.leaderId).toBe('b');
    expect(s2.events.some((e) => e.type === 'LEAD_CHANGE')).toBe(true);
    // no further change → no event
    const s3 = deriveRaceSnapshot(
      state({ a: rider({ cumulativeDistanceM: 110 }), b: rider({ cumulativeDistanceM: 220 }) }), cfg, s2);
    expect(s3.events.some((e) => e.type === 'LEAD_CHANGE')).toBe(false);
  });

  it('fires RIDER_FINISHED when finishTimeS newly set', () => {
    const cfg = { lapLengthM: 0 };
    const s1 = deriveRaceSnapshot(state({ a: rider({ cumulativeDistanceM: 900 }) }), cfg, null);
    const s2 = deriveRaceSnapshot(
      state({ a: rider({ cumulativeDistanceM: 1000, finishTimeS: 42 }) }), cfg, s1);
    expect(s2.events.some((e) => e.type === 'RIDER_FINISHED' && e.riderIds.includes('a'))).toBe(true);
  });
});
