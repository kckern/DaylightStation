import { describe, expect, it } from 'vitest';
import { isValidVolumeBounds, isValidVolumeLimit } from './volumeBounds.mjs';

describe('isValidVolumeLimit', () => {
  it.each([[0, true], [100, true], [50.5, true], [-1, false], [101, false], [Number.NaN, false], ['50', false]])(
    'validates %j as %s', (value, expected) => {
      expect(isValidVolumeLimit(value)).toBe(expected);
    },
  );
});

describe('isValidVolumeBounds', () => {
  it.each([
    [{ default: 50, min: 0, max: 75 }, true],
    [{ default: 0, min: 0, max: 100 }, true],
    [{ default: 100, min: 0, max: 100 }, true],
    [{ default: 50, min: 0, max: 30 }, false],
    [{ default: 50, min: 60, max: 75 }, false],
    [{ default: 50, min: 0, max: 101 }, false],
    [{ default: Number.NaN, min: 0, max: 100 }, false],
    [null, false],
  ])('validates %j as %s', (bounds, expected) => {
    expect(isValidVolumeBounds(bounds)).toBe(expected);
  });
});
