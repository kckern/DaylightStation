import { describe, it, expect } from 'vitest';
import { kmh, kmhLabel, participantDurationS } from './speed.js';

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
