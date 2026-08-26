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
    expect(readRingSeries({ 'milo:rings': [1, 2, 3] }, 'milo')).toEqual([1, 2, 3]);
  });

  it('falls back to the legacy coins key', () => {
    expect(readRingSeries({ 'milo:coins': [4, 5] }, 'milo')).toEqual([4, 5]);
  });

  it('prefers the new key when a file somehow carries both', () => {
    expect(readRingSeries({ 'milo:rings': [9], 'milo:coins': [1] }, 'milo')).toEqual([9]);
  });

  it('returns [] rather than undefined for an absent participant', () => {
    expect(readRingSeries({ 'felix:rings': [1] }, 'milo')).toEqual([]);
    expect(readRingSeries(null, 'milo')).toEqual([]);
  });

  it('ignores a non-array value under either key', () => {
    expect(readRingSeries({ 'milo:rings': 'rle-string' }, 'milo')).toEqual([]);
  });
});

describe('readRingTotalSeries', () => {
  it('reads the new namespaced key, then the legacy one', () => {
    expect(readRingTotalSeries({ 'user:milo:rings_total': [7] }, 'milo')).toEqual([7]);
    expect(readRingTotalSeries({ 'user:milo:coins_total': [8] }, 'milo')).toEqual([8]);
  });
});

describe('hasLegacyRingKeys', () => {
  it('detects a pre-rename session, which is what the migration verifies against', () => {
    expect(hasLegacyRingKeys({ 'milo:coins': [1] })).toBe(true);
    expect(hasLegacyRingKeys({ 'user:milo:coins_total': [1] })).toBe(true);
    expect(hasLegacyRingKeys({ 'milo:rings': [1] })).toBe(false);
    expect(hasLegacyRingKeys({})).toBe(false);
  });
});

describe('the healer reads legacy effort', () => {
  // This is the consequence that matters: occupantEffort decides whether a
  // participant did enough to be considered real. Reading [] for a legacy
  // session would misclassify every occupant in the entire pre-rename archive.
  const legacy = {
    'milo:hr': [120, 130, 140, 150],
    'milo:zone': ['a', 'a', 'w', 'h'],
    'milo:coins': [1, 5, 12, 40],
  };

  it('sees the rings a pre-rename session recorded', () => {
    expect(occupantEffort(legacy, 'milo').rings).toBe(40);
  });

  it('agrees with the same session written in the new shape', () => {
    const renamed = {
      'milo:hr': legacy['milo:hr'],
      'milo:zone': legacy['milo:zone'],
      'milo:rings': legacy['milo:coins'],
    };
    expect(occupantEffort(renamed, 'milo')).toEqual(occupantEffort(legacy, 'milo'));
  });
});
