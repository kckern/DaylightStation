import { describe, it, expect } from 'vitest';
import { resultsComparison, comparisonLines } from './resultsComparison.js';

describe('resultsComparison', () => {
  it('distance race: new best when faster than the previous best', () => {
    expect(resultsComparison({ winCondition: 'distance', value: 430, previousBest: 457, last: 470 }))
      .toEqual({ isBest: true, vsBest: -27, vsLast: -40, better: true });
  });
  it('time race: further is better', () => {
    expect(resultsComparison({ winCondition: 'time', value: 1200, previousBest: 1348, last: 1100 }))
      .toEqual({ isBest: false, vsBest: -148, vsLast: 100, better: false });
  });
  it('first ride at this length is a best with nothing to compare', () => {
    expect(resultsComparison({ winCondition: 'time', value: 900, previousBest: null, last: null }))
      .toEqual({ isBest: true, vsBest: null, vsLast: null, better: true });
  });
  it('a stopped or unfinished ride has no comparison', () => {
    expect(resultsComparison({ winCondition: 'distance', value: null, previousBest: 457 })).toBeNull();
  });
  it('equal to the previous best is NOT a new best', () => {
    expect(resultsComparison({ winCondition: 'distance', value: 457, previousBest: 457, last: 457 }))
      .toEqual({ isBest: false, vsBest: 0, vsLast: 0, better: false });
    expect(resultsComparison({ winCondition: 'time', value: 1348, previousBest: 1348 }).isBest).toBe(false);
  });
  it('a winCondition other than distance/time returns null', () => {
    expect(resultsComparison({ winCondition: 'laps', value: 10, previousBest: 20 })).toBeNull();
    expect(resultsComparison({ winCondition: null, value: 10, previousBest: 20 })).toBeNull();
  });
  it('non-finite previousBest/last are treated as absent', () => {
    expect(resultsComparison({ winCondition: 'distance', value: 430, previousBest: NaN, last: Infinity }))
      .toEqual({ isBest: true, vsBest: null, vsLast: null, better: true });
    expect(resultsComparison({ winCondition: 'time', value: 900, previousBest: undefined, last: 'x' }))
      .toEqual({ isBest: true, vsBest: null, vsLast: null, better: true });
  });
  it('an omitted winCondition defaults to distance', () => {
    expect(resultsComparison({ value: 10, previousBest: 20 }).isBest).toBe(true);
  });
  it('no argument does not throw', () => {
    expect(resultsComparison()).toBeNull();
  });
});

describe('comparisonLines', () => {
  it('new best with a previous best (distance)', () => {
    const cmp = resultsComparison({ winCondition: 'distance', value: 430, previousBest: 457, last: 470 });
    expect(comparisonLines(cmp, 'distance')).toEqual(['New best', '27 s faster']);
  });
  it('new best with a previous best (time)', () => {
    const cmp = resultsComparison({ winCondition: 'time', value: 1500, previousBest: 1352 });
    expect(comparisonLines(cmp, 'time')).toEqual(['New best', '148 m further']);
  });
  it('first ride', () => {
    const cmp = resultsComparison({ winCondition: 'time', value: 900 });
    expect(comparisonLines(cmp, 'time')).toEqual(['First ride at this length']);
    expect(comparisonLines({ isBest: true, vsBest: null, vsLast: null, better: true }, 'distance')).toEqual(['First ride at this length']);
  });
  it('not a best, distance, with last time faster / slower', () => {
    expect(comparisonLines({ isBest: false, vsBest: 27, vsLast: -12, better: false }, 'distance'))
      .toEqual(['27 s off your best', '12 s faster than last time']);
    expect(comparisonLines({ isBest: false, vsBest: 27, vsLast: 12, better: false }, 'distance'))
      .toEqual(['27 s off your best', '12 s slower than last time']);
  });
  it('not a best, time, with last time further / less', () => {
    expect(comparisonLines({ isBest: false, vsBest: -148, vsLast: 100, better: false }, 'time'))
      .toEqual(['148 m short of your best', '100 m further than last time']);
    expect(comparisonLines({ isBest: false, vsBest: -148, vsLast: -100, better: false }, 'time'))
      .toEqual(['148 m short of your best', '100 m less than last time']);
  });
  it('rounds to whole numbers; a rounded 0 vs last adds no line', () => {
    expect(comparisonLines({ isBest: false, vsBest: 26.6, vsLast: 0.4, better: false }, 'distance'))
      .toEqual(['27 s off your best']);
    expect(comparisonLines({ isBest: false, vsBest: 27, vsLast: 0, better: false }, 'distance'))
      .toEqual(['27 s off your best']);
    expect(comparisonLines({ isBest: false, vsBest: 27, vsLast: null, better: false }, 'distance'))
      .toEqual(['27 s off your best']);
    expect(comparisonLines({ isBest: false, vsBest: 27, vsLast: -11.6, better: false }, 'distance'))
      .toEqual(['27 s off your best', '12 s faster than last time']);
  });
  it('cmp null gives no lines', () => {
    expect(comparisonLines(null, 'distance')).toEqual([]);
    expect(comparisonLines(undefined, 'time')).toEqual([]);
  });
  it('an unknown winCondition gives no lines', () => {
    expect(comparisonLines({ isBest: true, vsBest: -1, vsLast: null, better: true }, 'laps')).toEqual([]);
  });
});
