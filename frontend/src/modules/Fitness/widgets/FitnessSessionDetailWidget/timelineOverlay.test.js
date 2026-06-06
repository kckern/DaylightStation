import { describe, it, expect } from 'vitest';
import { msToTickX, computeRaceBands, computeSeamLines } from './timelineOverlay.js';

const OPTS = { intervalMs: 5000, effectiveTicks: 5, plotWidth: 100, marginLeft: 0 };

describe('msToTickX', () => {
  it('maps compressed-axis ms to an x position via tick index', () => {
    expect(msToTickX(0, OPTS)).toBe(0);          // tick 0
    expect(msToTickX(15000, OPTS)).toBe(75);     // tick 3 -> (3/4)*100
    expect(msToTickX(20000, OPTS)).toBe(100);    // tick 4
  });
  it('clamps to marginLeft when effectiveTicks <= 1', () => {
    expect(msToTickX(9999, { ...OPTS, effectiveTicks: 1, marginLeft: 7 })).toBe(7);
  });
});

describe('computeRaceBands', () => {
  it('produces x/width rects for each race item with winner + raceId', () => {
    const activities = [{ type: 'cycle-game', items: [
      { axisStartMs: 15000, axisEndMs: 20000, meta: { winnerId: 'milo', raceId: 'r1' } },
    ] }];
    const bands = computeRaceBands(activities, OPTS);
    expect(bands).toEqual([{ x: 75, width: 25, winnerId: 'milo', raceId: 'r1' }]);
  });
  it('falls back to a 0-width-safe band and skips items without axis fields', () => {
    const activities = [{ type: 'cycle-game', items: [ { meta: {} } ] }];
    expect(computeRaceBands(activities, OPTS)).toEqual([]);
  });
  it('returns [] for no activities', () => {
    expect(computeRaceBands(undefined, OPTS)).toEqual([]);
    expect(computeRaceBands([], OPTS)).toEqual([]);
  });
});

describe('computeSeamLines', () => {
  it('places a dashed line at each seam atMs with its gapMs', () => {
    expect(computeSeamLines([{ atMs: 15000, gapMs: 585000 }], OPTS))
      .toEqual([{ x: 75, gapMs: 585000 }]);
  });
  it('returns [] for no seams', () => {
    expect(computeSeamLines(undefined, OPTS)).toEqual([]);
  });
});
