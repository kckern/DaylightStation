import { describe, it, expect } from 'vitest';
import { buildZoneProgressIndex, lookupZoneProgress } from './zoneProgressIndex.js';

// Mirrors FitnessContext userVitalsMap: keyed by user.id, value carries
// name (given name) + displayLabel (group label when preferGroupLabels).
const VITALS = new Map([
  ['user_1', { name: 'Kevin', displayLabel: 'Dad', progress: 0.66, profileId: 'user_1' }],
  ['user_4', { name: 'Felix', displayLabel: 'Felix', progress: 0.33, profileId: 'user_4' }],
]);

describe('buildZoneProgressIndex', () => {
  it('indexes by profileId', () => {
    const index = buildZoneProgressIndex(VITALS);
    expect(index.get('user_1').progress).toBe(0.66);
  });

  it('indexes by given name', () => {
    const index = buildZoneProgressIndex(VITALS);
    expect(index.get('Kevin').progress).toBe(0.66);
  });

  it('REGRESSION: indexes by group-label displayLabel', () => {
    // The 2026-07-21 sidebar-sort bug: the sort asked for "Dad" and got nothing.
    const index = buildZoneProgressIndex(VITALS);
    expect(index.get('Dad').progress).toBe(0.66);
  });

  it('gives profileId precedence when a display label collides with another id', () => {
    const colliding = new Map([
      ['Dad', { name: 'Someone', displayLabel: 'Someone', progress: 0.1, profileId: 'Dad' }],
      ['user_1', { name: 'Kevin', displayLabel: 'Dad', progress: 0.66, profileId: 'user_1' }],
    ]);
    const index = buildZoneProgressIndex(colliding);
    expect(index.get('Dad').progress).toBe(0.1); // the real id wins
  });

  it('accepts a plain object as well as a Map', () => {
    const index = buildZoneProgressIndex({ user_1: { name: 'Kevin', progress: 0.5 } });
    expect(index.get('Kevin').progress).toBe(0.5);
  });

  it('returns an empty index for null/undefined', () => {
    expect(buildZoneProgressIndex(null).size).toBe(0);
    expect(buildZoneProgressIndex(undefined).size).toBe(0);
  });

  it('skips blank and whitespace-only aliases', () => {
    const index = buildZoneProgressIndex(new Map([['u', { name: '   ', progress: 0.2, profileId: 'u' }]]));
    expect(index.has('')).toBe(false);
    expect(index.get('u').progress).toBe(0.2);
  });
});

describe('lookupZoneProgress', () => {
  it('tries keys in order and returns the first hit', () => {
    const index = buildZoneProgressIndex(VITALS);
    const hit = lookupZoneProgress(index, { profileId: 'user_1', name: 'Kevin' });
    expect(hit.progress).toBe(0.66);
  });

  it('falls through a missing profileId to the name', () => {
    const index = buildZoneProgressIndex(VITALS);
    expect(lookupZoneProgress(index, { profileId: 'nope', name: 'Felix' }).progress).toBe(0.33);
  });

  it('returns null when nothing matches', () => {
    const index = buildZoneProgressIndex(VITALS);
    expect(lookupZoneProgress(index, { profileId: 'ghost' })).toBeNull();
  });

  it('returns null for a null index', () => {
    expect(lookupZoneProgress(null, { profileId: 'user_1' })).toBeNull();
  });
});
