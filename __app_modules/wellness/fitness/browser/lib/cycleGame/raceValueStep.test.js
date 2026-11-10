import { describe, it, expect } from 'vitest';
import { stepRaceValue, RACE_VALUE_LIMITS } from './raceValueStep.js';

describe('stepRaceValue', () => {
  it.each([
    ['distance', 100, 1, 200], ['distance', 300, -1, 200], ['distance', 900, 1, 1000],
    ['distance', 1000, 1, 1500], ['distance', 1000, -1, 900], ['distance', 1500, -1, 1000],
    ['distance', 100, -1, 100], ['distance', 10000, 1, 10000],
    ['time', 60, -1, 60], ['time', 300, 1, 360], ['time', 1800, 1, 1800]
  ])('%s %i %i → %i', (type, v, dir, out) => expect(stepRaceValue(type, v, dir)).toBe(out));
  it('snaps an off-grid value onto the grid', () => expect(stepRaceValue('distance', 2750, 1)).toBe(3000));
  it('exposes limits', () => expect(RACE_VALUE_LIMITS.time.max).toBe(1800));

  it.each([[NaN], [Infinity], [undefined], [null], ['abc'], [{}]])('non-finite or non-numeric value %p returns the distance minimum', (v) => {
    expect(stepRaceValue('distance', v, 1)).toBe(RACE_VALUE_LIMITS.distance.min);
  });
  it('non-finite value returns the time minimum for time', () => {
    expect(stepRaceValue('time', NaN, -1)).toBe(RACE_VALUE_LIMITS.time.min);
    expect(stepRaceValue('time', undefined, 1)).toBe(RACE_VALUE_LIMITS.time.min);
  });
  it('an unknown type is treated as distance', () => {
    expect(stepRaceValue('bogus', 1000, 1)).toBe(1500);
    expect(stepRaceValue(undefined, 100, 1)).toBe(200);
  });
  it('dir 0 returns the value clamped and snapped, unchanged otherwise', () => {
    expect(stepRaceValue('distance', 1500, 0)).toBe(1500);
    expect(stepRaceValue('distance', 20000, 0)).toBe(10000);
    expect(stepRaceValue('distance', 10, 0)).toBe(100);
    expect(stepRaceValue('distance', 340, 0)).toBe(300);
    expect(stepRaceValue('time', 300, 0)).toBe(300);
    expect(stepRaceValue('time', 5000, 0)).toBe(1800);
    expect(stepRaceValue('time', 20, 0)).toBe(60);
  });
});
