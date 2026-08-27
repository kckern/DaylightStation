/**
 * Dual-read regression for the 2026-08-26 coins→rings rename.
 *
 * These exist because the golden fixture tests DON'T cover this: they assert on
 * occupant removal and never look at a ring value, so they pass identically
 * whether the reader finds the series or silently gets `[]`. An empty series
 * reads as "that participant earned nothing", which is indistinguishable from
 * a healthy read — the exact shape of bug that ships unnoticed.
 */
import { describe, it, expect } from 'vitest';
import { readRingSeries, readRingTotalSeries, hasLegacyRingKeys } from './ringSeries.mjs';
import { occupantEffort } from './SessionIdentityHealer.mjs';

describe('readRingSeries', () => {
  it('reads the new key', () => {
    expect(readRingSeries({ 'user_4:rings': [1, 2, 3] }, 'user_4')).toEqual([1, 2, 3]);
  });

  it('falls back to the legacy coins key', () => {
    expect(readRingSeries({ 'user_4:coins': [4, 5] }, 'user_4')).toEqual([4, 5]);
  });

  it('prefers the new key when a file somehow carries both', () => {
    expect(readRingSeries({ 'user_4:rings': [9], 'user_4:coins': [1] }, 'user_4')).toEqual([9]);
  });

  it('returns [] rather than undefined for an absent participant', () => {
    expect(readRingSeries({ 'user_3:rings': [1] }, 'user_4')).toEqual([]);
    expect(readRingSeries(null, 'user_4')).toEqual([]);
  });

  it('ignores a non-array value under either key', () => {
    expect(readRingSeries({ 'user_4:rings': 'rle-string' }, 'user_4')).toEqual([]);
  });
});

describe('readRingTotalSeries', () => {
  it('reads the new namespaced key, then the legacy one', () => {
    expect(readRingTotalSeries({ 'user:user_4:rings_total': [7] }, 'user_4')).toEqual([7]);
    expect(readRingTotalSeries({ 'user:user_4:coins_total': [8] }, 'user_4')).toEqual([8]);
  });
});

describe('hasLegacyRingKeys', () => {
  it('detects a pre-rename session, which is what the migration verifies against', () => {
    expect(hasLegacyRingKeys({ 'user_4:coins': [1] })).toBe(true);
    expect(hasLegacyRingKeys({ 'user:user_4:coins_total': [1] })).toBe(true);
    expect(hasLegacyRingKeys({ 'user_4:rings': [1] })).toBe(false);
    expect(hasLegacyRingKeys({})).toBe(false);
  });
});

describe('the healer reads legacy effort', () => {
  // This is the consequence that matters: occupantEffort decides whether a
  // participant did enough to be considered real. Reading [] for a legacy
  // session would misclassify every occupant in the entire pre-rename archive.
  const legacy = {
    'user_4:hr': [120, 130, 140, 150],
    'user_4:zone': ['a', 'a', 'w', 'h'],
    'user_4:coins': [1, 5, 12, 40],
  };

  it('sees the rings a pre-rename session recorded', () => {
    expect(occupantEffort(legacy, 'user_4').rings).toBe(40);
  });

  it('agrees with the same session written in the new shape', () => {
    const renamed = {
      'user_4:hr': legacy['user_4:hr'],
      'user_4:zone': legacy['user_4:zone'],
      'user_4:rings': legacy['user_4:coins'],
    };
    expect(occupantEffort(renamed, 'user_4')).toEqual(occupantEffort(legacy, 'user_4'));
  });
});
