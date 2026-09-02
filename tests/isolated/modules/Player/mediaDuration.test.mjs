import { describe, it, expect } from 'vitest';
import { durationFromSeconds, durationFromMs } from '#frontend/modules/Player/utils/mediaIdentity.js';

// Replaces normalizeDuration.test.mjs, which enshrined a magnitude heuristic
// ("1800 is > 1000 so treated as 1800ms -> 2s") that corrupted every video
// longer than 16m40s once its input switched from milliseconds to seconds.
// Units are now declared by the caller, so no test can assert a guess.
// See docs/_wip/bugs/2026-09-01-media-duration-divided-twice.md

describe('durationFromSeconds', () => {
  it('takes a seconds value as-is, rounded', () => {
    expect(durationFromSeconds(30)).toBe(30);
    expect(durationFromSeconds(30.4)).toBe(30);
    expect(durationFromSeconds(30.6)).toBe(31);
  });

  it('does NOT rescale a long duration — the whole point of the fix', () => {
    expect(durationFromSeconds(1941)).toBe(1941);   // 32m21s, previously stored as 2
    expect(durationFromSeconds(1001)).toBe(1001);   // previously the threshold cliff
    expect(durationFromSeconds(16725)).toBe(16725); // a long game session
  });

  it('parses numeric strings', () => {
    expect(durationFromSeconds('1800')).toBe(1800);
    expect(durationFromSeconds('45.7')).toBe(46);
  });

  it('takes the first usable candidate, in order', () => {
    expect(durationFromSeconds(null, 600, 900)).toBe(600);
    expect(durationFromSeconds(undefined, 'abc', 0, -5, 25)).toBe(25);
  });

  it('accepts genuinely short media without special-casing', () => {
    expect(durationFromSeconds(2)).toBe(2);
    expect(durationFromSeconds(9)).toBe(9);
  });

  it('rejects absent, non-numeric, zero and negative values', () => {
    expect(durationFromSeconds()).toBe(null);
    expect(durationFromSeconds(null, undefined)).toBe(null);
    expect(durationFromSeconds(NaN, Infinity, -Infinity)).toBe(null);
    expect(durationFromSeconds(0, -5, 'abc', '')).toBe(null);
  });
});

describe('durationFromMs', () => {
  it('converts milliseconds to whole seconds', () => {
    expect(durationFromMs(60000)).toBe(60);
    expect(durationFromMs(1941509)).toBe(1942);
    expect(durationFromMs(60499)).toBe(60);
    expect(durationFromMs(60500)).toBe(61);
  });

  it('converts sub-second values honestly rather than discarding them', () => {
    expect(durationFromMs(400)).toBe(0);
  });

  it('parses numeric strings and walks candidates in order', () => {
    expect(durationFromMs('1800000')).toBe(1800);
    expect(durationFromMs(null, 120000)).toBe(120);
  });

  it('rejects absent, non-numeric, zero and negative values', () => {
    expect(durationFromMs()).toBe(null);
    expect(durationFromMs(0, -1000, 'abc')).toBe(null);
  });
});

describe('the two helpers disagree, which is the point', () => {
  it('reads the same number differently because the caller declares the unit', () => {
    expect(durationFromSeconds(1800)).toBe(1800);
    expect(durationFromMs(1800)).toBe(2);
  });
});
