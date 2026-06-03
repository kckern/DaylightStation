import { describe, it, expect } from 'vitest';
import { zoneMultiplierFor, zoneColorFor, computeDistanceDelta } from './distanceModel.js';

const ZONES = [
  { id: 'cool',   distance_multiplier: 0.5, color: '#3b82f6' },
  { id: 'active', distance_multiplier: 1.0, color: '#22c55e' },
  { id: 'warm',   distance_multiplier: 1.5, color: '#eab308' },
  { id: 'hot',    distance_multiplier: 2.0, color: '#ef4444' },
  { id: 'fire',   distance_multiplier: 3.0, color: '#a21caf' }
];

describe('zoneMultiplierFor', () => {
  it('returns the zone multiplier, case-insensitive', () => {
    expect(zoneMultiplierFor('hot', ZONES)).toBe(2);
    expect(zoneMultiplierFor('HOT', ZONES)).toBe(2);
    expect(zoneMultiplierFor('cool', ZONES)).toBe(0.5);
  });
  it('uses the HR-less multiplier when there is no zone', () => {
    expect(zoneMultiplierFor(null, ZONES, 1)).toBe(1);
    expect(zoneMultiplierFor(undefined, ZONES, 1)).toBe(1);
  });
  it('falls back to the HR-less multiplier for an unknown zone', () => {
    expect(zoneMultiplierFor('bogus', ZONES, 1)).toBe(1);
  });
  it('defaults the HR-less multiplier to 1', () => {
    expect(zoneMultiplierFor(null, ZONES)).toBe(1);
  });
});

describe('zoneColorFor', () => {
  it('returns the zone color, case-insensitive', () => {
    expect(zoneColorFor('hot', ZONES)).toBe('#ef4444');
    expect(zoneColorFor('HOT', ZONES)).toBe('#ef4444');
  });
  it('returns null for no zone or an unknown zone', () => {
    expect(zoneColorFor(null, ZONES)).toBeNull();
    expect(zoneColorFor('bogus', ZONES)).toBeNull();
    expect(zoneColorFor('hot', [])).toBeNull();
  });
});

describe('computeDistanceDelta', () => {
  it('multiplies rotations × circumference × multiplier', () => {
    expect(computeDistanceDelta(10, 2.1, 2)).toBeCloseTo(42, 5);
    expect(computeDistanceDelta(10, 1.2, 1)).toBeCloseTo(12, 5);
  });
  it('returns 0 for non-positive or invalid inputs', () => {
    expect(computeDistanceDelta(0, 2.1, 2)).toBe(0);
    expect(computeDistanceDelta(10, undefined, 2)).toBe(0);
    expect(computeDistanceDelta(10, 2.1, undefined)).toBe(0);
    expect(computeDistanceDelta(-5, 2.1, 2)).toBe(0);
  });
});
