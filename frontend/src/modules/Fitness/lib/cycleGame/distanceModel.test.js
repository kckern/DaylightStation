import { describe, it, expect } from 'vitest';
import { zoneMultiplierFor, zoneColorFor, computeDistanceDelta, resolveWheelCircumferenceM, DEFAULT_WHEEL_CIRCUMFERENCE_M } from './distanceModel.js';

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

describe('resolveWheelCircumferenceM', () => {
  it('returns the configured wheel size', () => {
    expect(resolveWheelCircumferenceM({ id: 'cycle_ace', wheel_circumference_m: 2.1 })).toBe(2.1);
    expect(resolveWheelCircumferenceM({ id: 'ab_roller', wheel_circumference_m: 1.4 })).toBe(1.4);
  });
  it('falls back to the default when the bike has no usable wheel size (never 0)', () => {
    // A bike whose config forgot wheel_circumference_m must still cover ground —
    // the 2026-09-08 Generic Pedaler race scored 0 m at 186 rpm because it fell to 0.
    expect(resolveWheelCircumferenceM({ id: 'generic_pedaler' })).toBe(DEFAULT_WHEEL_CIRCUMFERENCE_M);
    expect(resolveWheelCircumferenceM({ id: 'x', wheel_circumference_m: 0 })).toBe(DEFAULT_WHEEL_CIRCUMFERENCE_M);
    expect(resolveWheelCircumferenceM({ id: 'x', wheel_circumference_m: -1 })).toBe(DEFAULT_WHEEL_CIRCUMFERENCE_M);
    expect(resolveWheelCircumferenceM({ id: 'x', wheel_circumference_m: 'big' })).toBe(DEFAULT_WHEEL_CIRCUMFERENCE_M);
    expect(resolveWheelCircumferenceM(null)).toBe(DEFAULT_WHEEL_CIRCUMFERENCE_M);
    expect(resolveWheelCircumferenceM(undefined)).toBe(DEFAULT_WHEEL_CIRCUMFERENCE_M);
    expect(DEFAULT_WHEEL_CIRCUMFERENCE_M).toBeGreaterThan(0);
  });
});
