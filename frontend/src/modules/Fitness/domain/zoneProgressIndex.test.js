import { describe, it, expect } from 'vitest';
import { buildZoneProgressIndex, lookupZoneProgress } from './zoneProgressIndex.js';

// Mirrors FitnessContext userVitalsMap: keyed by user.id, value carries
// name (given name) + displayLabel (group label when preferGroupLabels).
const VITALS = new Map([
  ['user_1', { name: 'test-parent', displayLabel: 'Dad', progress: 0.66, profileId: 'user_1' }],
  ['user_4', { name: 'test-child', displayLabel: 'test-child', progress: 0.33, profileId: 'user_4' }],
]);

describe('buildZoneProgressIndex', () => {
  it('indexes by profileId', () => {
    const index = buildZoneProgressIndex(VITALS);
    expect(index.get('user_1').progress).toBe(0.66);
  });

  it('indexes by given name', () => {
    const index = buildZoneProgressIndex(VITALS);
    expect(index.get('test-parent').progress).toBe(0.66);
  });

  it('REGRESSION: indexes by group-label displayLabel', () => {
    // The 2026-07-21 sidebar-sort bug: the sort asked for "Dad" and got nothing.
    const index = buildZoneProgressIndex(VITALS);
    expect(index.get('Dad').progress).toBe(0.66);
  });

  it('gives profileId precedence when a display label collides with another id', () => {
    const colliding = new Map([
      ['Dad', { name: 'Someone', displayLabel: 'Someone', progress: 0.1, profileId: 'Dad' }],
      ['user_1', { name: 'test-parent', displayLabel: 'Dad', progress: 0.66, profileId: 'user_1' }],
    ]);
    const index = buildZoneProgressIndex(colliding);
    expect(index.get('Dad').progress).toBe(0.1); // the real id wins
  });

  it('accepts a plain object as well as a Map', () => {
    const index = buildZoneProgressIndex({ user_1: { name: 'test-parent', progress: 0.5 } });
    expect(index.get('test-parent').progress).toBe(0.5);
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

  it('indexes by deviceId', () => {
    // resolveDisplayName falls back to the raw device ID string when a strap
    // has no resolved user (userDisplayName.js:167), so a caller's "display
    // name" can legitimately BE a device ID.
    const index = buildZoneProgressIndex(new Map([
      ['user_1', { name: 'test-parent', displayLabel: 'Dad', deviceId: '12345', progress: 0.66, profileId: 'user_1' }],
    ]));
    expect(index.get('12345').progress).toBe(0.66);
  });

  it('gives deviceId precedence over a colliding name', () => {
    const colliding = new Map([
      ['user_1', { name: 'test-parent', deviceId: 'dev_a', progress: 0.66, profileId: 'user_1' }],
      ['user_2', { name: 'dev_a', deviceId: 'dev_b', progress: 0.2, profileId: 'user_2' }],
    ]);
    const index = buildZoneProgressIndex(colliding);
    expect(index.get('dev_a').progress).toBe(0.66); // the real device id wins
  });

  it('indexes every strap in deviceIds, not just the primary', () => {
    // Multi-strap users: participantLookupByDevice already indexes ALL device
    // IDs, so this index must too or multi-strap users regress to a miss.
    const index = buildZoneProgressIndex(new Map([
      ['user_1', {
        name: 'test-parent', displayLabel: 'Dad', deviceId: 'dev_primary',
        deviceIds: ['dev_primary', 'dev_secondary'], progress: 0.66, profileId: 'user_1',
      }],
    ]));
    expect(index.get('dev_secondary').progress).toBe(0.66);
    expect(index.get('dev_primary').progress).toBe(0.66);
  });

  it('does not let a deviceIds entry override a higher-precedence alias', () => {
    // user_2 lists user_1's profileId and primary deviceId among its straps.
    // Both higher-precedence passes have already claimed those aliases.
    const colliding = new Map([
      ['user_1', { name: 'test-parent', deviceId: 'dev_a', progress: 0.66, profileId: 'user_1' }],
      ['user_2', { name: 'Sam', deviceIds: ['user_1', 'dev_a', 'dev_own'], progress: 0.11, profileId: 'user_2' }],
    ]);
    const index = buildZoneProgressIndex(colliding);
    expect(index.get('user_1').progress).toBe(0.66); // profileId pass wins
    expect(index.get('dev_a').progress).toBe(0.66);  // deviceId pass wins
    expect(index.get('dev_own').progress).toBe(0.11); // uncontested strap resolves
  });

  it('gives deviceIds precedence over a colliding name', () => {
    const colliding = new Map([
      ['user_1', { name: 'test-parent', deviceIds: ['dev_x'], progress: 0.66, profileId: 'user_1' }],
      ['user_2', { name: 'dev_x', progress: 0.2, profileId: 'user_2' }],
    ]);
    const index = buildZoneProgressIndex(colliding);
    expect(index.get('dev_x').progress).toBe(0.66);
  });

  it('tolerates a missing or non-array deviceIds', () => {
    const index = buildZoneProgressIndex(new Map([
      ['user_1', { name: 'test-parent', progress: 0.66, profileId: 'user_1' }],
      ['user_2', { name: 'Sam', deviceIds: 'not-an-array', progress: 0.11, profileId: 'user_2' }],
    ]));
    expect(index.get('test-parent').progress).toBe(0.66);
    expect(index.get('Sam').progress).toBe(0.11);
    expect(index.has('not-an-array')).toBe(false);
  });

  it('resolves a shared group label to one arbitrary user (first writer wins)', () => {
    // Two participants can share a group_label. A label-only lookup is
    // therefore AMBIGUOUS — callers must pass profileId first.
    const shared = new Map([
      ['user_1', { name: 'test-parent', displayLabel: 'Dad', progress: 0.66, profileId: 'user_1' }],
      ['user_2', { name: 'Sam', displayLabel: 'Dad', progress: 0.11, profileId: 'user_2' }],
    ]);
    const index = buildZoneProgressIndex(shared);
    expect(index.get('Dad').progress).toBe(0.66); // first entry wins; NOT user_2
    // Each user remains individually addressable by their stable id.
    expect(index.get('user_1').progress).toBe(0.66);
    expect(index.get('user_2').progress).toBe(0.11);
  });
});

describe('lookupZoneProgress', () => {
  it('tries keys in order and returns the first hit', () => {
    const index = buildZoneProgressIndex(VITALS);
    const hit = lookupZoneProgress(index, { profileId: 'user_1', name: 'test-parent' });
    expect(hit.progress).toBe(0.66);
  });

  it('falls through a missing profileId to the name', () => {
    const index = buildZoneProgressIndex(VITALS);
    expect(lookupZoneProgress(index, { profileId: 'nope', name: 'test-child' }).progress).toBe(0.33);
  });

  it('returns null when nothing matches', () => {
    const index = buildZoneProgressIndex(VITALS);
    expect(lookupZoneProgress(index, { profileId: 'ghost' })).toBeNull();
  });

  it('returns null for a null index', () => {
    expect(lookupZoneProgress(null, { profileId: 'user_1' })).toBeNull();
  });

  it('returns the entry for progress 0 rather than treating it as a miss', () => {
    // Callers write `lookup(...)?.progress ?? 0`, so a miss and a real 0 both
    // collapse to 0 at the call site. Returning the ENTRY (not the number) is
    // what keeps them distinguishable — 0 was the exact wrong value the
    // 2026-07-21 bug produced.
    const index = buildZoneProgressIndex(new Map([['u1', { name: 'test-parent', progress: 0, profileId: 'u1' }]]));
    const hit = lookupZoneProgress(index, { name: 'test-parent' });
    expect(hit).not.toBeNull();
    expect(hit.progress).toBe(0);
  });

  it('resolves by deviceId when no profileId or name is held', () => {
    const index = buildZoneProgressIndex(new Map([
      ['user_1', { name: 'test-parent', displayLabel: 'Dad', deviceId: '12345', progress: 0.66, profileId: 'user_1' }],
    ]));
    expect(lookupZoneProgress(index, { deviceId: '12345' }).progress).toBe(0.66);
  });
});
