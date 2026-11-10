import { describe, it, expect } from 'vitest';
import { distanceAtTime, timeAtDistance, paceDelta } from './paceDelta.js';

const rival = [5, 10, 15, 20, 25, 30]; // 5 m/s, one sample per second

describe('paceDelta', () => {
  it('distanceAtTime interpolates and clamps', () => {
    expect(distanceAtTime(rival, 0)).toBe(0);
    expect(distanceAtTime(rival, 2.5)).toBe(12.5);
    expect(distanceAtTime(rival, 99)).toBe(30);
  });
  it('timeAtDistance interpolates; null beyond the recording', () => {
    expect(timeAtDistance(rival, 12.5)).toBe(2.5);
    expect(timeAtDistance(rival, 31)).toBeNull();
  });
  it('ahead: positive seconds and metres', () => {
    expect(paceDelta({ riderDistanceM: 20, elapsedS: 3, rivalSeries: rival })).toEqual({ gapM: 5, gapS: 1, ahead: true });
  });
  it('behind: negative seconds and metres', () => {
    expect(paceDelta({ riderDistanceM: 10, elapsedS: 4, rivalSeries: rival })).toEqual({ gapM: -10, gapS: -2, ahead: false });
  });
  it('past the end of the recording: metres only', () => {
    expect(paceDelta({ riderDistanceM: 40, elapsedS: 6, rivalSeries: rival })).toEqual({ gapM: 10, gapS: null, ahead: true });
  });
  it('no rival series → null', () => expect(paceDelta({ riderDistanceM: 5, elapsedS: 1, rivalSeries: [] })).toBeNull());

  describe('intervalS of 5', () => {
    const s = [10, 20, 30]; // samples at 5, 10, 15 s
    it('distanceAtTime', () => {
      expect(distanceAtTime(s, 5, 5)).toBe(10);
      expect(distanceAtTime(s, 2.5, 5)).toBe(5);
      expect(distanceAtTime(s, 7.5, 5)).toBe(15);
      expect(distanceAtTime(s, 100, 5)).toBe(30);
    });
    it('timeAtDistance', () => {
      expect(timeAtDistance(s, 10, 5)).toBe(5);
      expect(timeAtDistance(s, 25, 5)).toBe(12.5);
    });
    it('paceDelta', () => {
      expect(paceDelta({ riderDistanceM: 20, elapsedS: 5, rivalSeries: s, intervalS: 5 })).toEqual({ gapM: 10, gapS: 5, ahead: true });
    });
  });

  describe('flat stretch (rival stopped)', () => {
    const s = [5, 10, 10, 10, 15]; // stopped from t=2 to t=4
    it('distanceAtTime holds the distance through the stop', () => {
      expect(distanceAtTime(s, 2, 1)).toBe(10);
      expect(distanceAtTime(s, 3, 1)).toBe(10);
      expect(distanceAtTime(s, 4, 1)).toBe(10);
      expect(distanceAtTime(s, 4.5, 1)).toBe(12.5);
    });
    it('timeAtDistance returns the FIRST time the distance was reached', () => {
      expect(timeAtDistance(s, 10)).toBe(2);
      expect(timeAtDistance(s, 12.5)).toBe(4.5);
    });
    it('a series that starts flat', () => {
      const z = [0, 0, 5];
      expect(timeAtDistance(z, 0.0001)).toBeCloseTo(2 + 0.0001 / 5, 6);
      expect(distanceAtTime(z, 1)).toBe(0);
    });
  });

  describe('bad input', () => {
    it.each([[null], [undefined], [[]], ['nope'], [{}], [42]])('series %p', (s) => {
      expect(distanceAtTime(s, 3)).toBe(0);
      expect(timeAtDistance(s, 3)).toBeNull();
      expect(paceDelta({ riderDistanceM: 3, elapsedS: 1, rivalSeries: s })).toBeNull();
    });
    it('negative or NaN time/distance', () => {
      expect(distanceAtTime(rival, -3)).toBe(0);
      expect(distanceAtTime(rival, NaN)).toBe(0);
      expect(timeAtDistance(rival, -1)).toBe(0);
      expect(timeAtDistance(rival, NaN)).toBe(0);
    });
    it('paceDelta never throws and never returns NaN', () => {
      for (const args of [
        { riderDistanceM: NaN, elapsedS: NaN, rivalSeries: rival },
        { riderDistanceM: -5, elapsedS: -2, rivalSeries: rival },
        { riderDistanceM: 5, elapsedS: 1, rivalSeries: rival, intervalS: 0 },
        { riderDistanceM: 5, elapsedS: 1, rivalSeries: rival, intervalS: NaN },
        { riderDistanceM: 'x', elapsedS: undefined, rivalSeries: rival }
      ]) {
        const out = paceDelta(args);
        expect(out).not.toBeNull();
        expect(Number.isNaN(out.gapM)).toBe(false);
        expect(out.gapS === null || Number.isFinite(out.gapS)).toBe(true);
      }
    });
    it('no argument at all → null', () => expect(paceDelta()).toBeNull());
  });
});
