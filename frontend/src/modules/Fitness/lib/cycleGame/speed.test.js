import { describe, it, expect } from 'vitest';
import { kmh, kmhLabel, participantDurationS, windowedSeriesKmh } from './speed.js';

describe('kmh', () => {
  it('converts metres over seconds to km/h', () => {
    expect(kmh(1000, 120)).toBeCloseTo(30, 5); // 1000 m / 120 s = 30 km/h
    expect(kmh(300, 60)).toBeCloseTo(18, 5);
  });
  it('returns 0 for non-positive distance or duration', () => {
    expect(kmh(0, 60)).toBe(0);
    expect(kmh(500, 0)).toBe(0);
    expect(kmh(null, 60)).toBe(0);
    expect(kmh(500, undefined)).toBe(0);
  });
});

describe('kmhLabel', () => {
  it('formats to a whole number with a unit', () => {
    expect(kmhLabel(1000, 120)).toBe('30 km/h');
    expect(kmhLabel(0, 60)).toBe('0 km/h');
  });
});

describe('participantDurationS', () => {
  it('prefers the finish time, falls back to the time cap', () => {
    expect(participantDurationS({ finalTimeS: 90 }, 300)).toBe(90);   // distance race finisher
    expect(participantDurationS({ finalTimeS: null }, 300)).toBe(300); // time race → cap
    expect(participantDurationS({ finalTimeS: 0 }, 300)).toBe(300);    // 0 is not a real finish
    expect(participantDurationS({}, null)).toBe(0);
  });
});

describe('windowedSeriesKmh', () => {
  // Steady 8.4 m/s saved as rounded cumulative metres — 1-tick deltas alternate 8/9.
  const series = [8, 17, 25, 34, 42, 50, 59, 67];
  it('averages over the trailing window to smooth integer-metre jitter', () => {
    const v = windowedSeriesKmh(series, 6, 1); // window [t=1..6]: (59-17)/5s = 8.4 m/s
    expect(v).toBeCloseTo(30.24, 2);
  });
  it('uses the first sample alone at tick 0', () => {
    expect(windowedSeriesKmh(series, 0, 1)).toBeCloseTo(28.8, 5); // 8 m in 1 s
  });
  it('divides by the recording interval', () => {
    expect(windowedSeriesKmh([10, 20, 30], 2, 5)).toBeCloseTo(7.2, 5); // 20 m over 10 s
  });
  it('clamps the tick index into the series and handles empties', () => {
    expect(windowedSeriesKmh(series, 99, 1)).toBe(windowedSeriesKmh(series, 7, 1));
    expect(windowedSeriesKmh([], 3, 1)).toBe(0);
    expect(windowedSeriesKmh(null, 3, 1)).toBe(0);
  });
});
