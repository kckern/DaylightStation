import { describe, expect, it } from 'vitest';
import { INVADERS_TUNABLES } from './tunables.js';
import { SHOT_TIERS, shotTier } from './tiers.js';
import { trustedZoneId, weaponPower, zonePower } from '../skylineGlider/weaponPower.js';

const now = 100000;
const reading = { zoneTrusted: true, zoneReadingEligible: true, zoneReadingAt: now, currentZoneId: 'warm' };

describe('shotTier', () => {
  it('maps the five zones onto four shot tiers', () => {
    const tiers = ['cool', 'active', 'warm', 'hot', 'fire'].map((zone) => shotTier({ ...reading, currentZoneId: zone }, now).tier);
    expect(tiers).toEqual(['small', 'small', 'big', 'spread', 'nuke']);
  });
  it('falls back to small and says so when the zone is untrusted, stale or missing', () => {
    for (const profile of [null, {}, { ...reading, zoneTrusted: false }, { ...reading, zoneReadingAt: now - 30000 }]) {
      expect(shotTier(profile, now)).toEqual({ tier: 'small', zoneId: null, trusted: false });
    }
    expect(shotTier({ ...reading, currentZoneId: 'fire' }, now)).toEqual({ tier: 'nuke', zoneId: 'fire', trusted: true });
  });
  it('reports a trusted cool zone as trusted, so the HUD note only shows for a missing heart rate', () => {
    expect(shotTier({ ...reading, currentZoneId: 'cool' }, now)).toEqual({ tier: 'small', zoneId: 'cool', trusted: true });
  });
  it('leaves Skyline Glider weapon power unchanged', () => {
    expect(weaponPower({ ...reading, currentZoneId: 'hot' }, now)).toBe(3);
    expect(weaponPower({ ...reading, zoneReadingEligible: false }, now)).toBe(1);
  });
  it('exposes the trusted zone id, null when the reading cannot be trusted', () => {
    expect(trustedZoneId(reading, now)).toBe('warm');
    expect(trustedZoneId({ ...reading, zoneReadingAt: now + 1 }, now)).toBeNull();
    expect(trustedZoneId({ ...reading, zoneReadingAt: now - 10001 }, now)).toBeNull();
    expect(trustedZoneId({ ...reading, currentZoneId: undefined }, now)).toBeNull();
  });
  it('reads the clock itself when no time is given', () => {
    expect(shotTier({ ...reading, currentZoneId: 'hot', zoneReadingAt: Date.now() })).toEqual({ tier: 'spread', zoneId: 'hot', trusted: true });
    expect(shotTier({ ...reading, currentZoneId: 'hot', zoneReadingAt: Date.now() - 60000 }).trusted).toBe(false);
  });
  it('ranks a zone id as a power without needing a profile', () => {
    expect(['cool', 'active', 'warm', 'hot', 'fire', null, 'purple'].map(zonePower)).toEqual([1, 1, 2, 3, 4, 1, 1]);
  });
  it('describes each tier as damage, hitbox and spread', () => {
    expect(SHOT_TIERS.small).toMatchObject({ damage: 1, spread: [0] });
    expect(SHOT_TIERS.big.damage).toBe(2);
    expect(SHOT_TIERS.big.halfWidth).toBeGreaterThan(SHOT_TIERS.small.halfWidth);
    expect(SHOT_TIERS.spread.spread).toHaveLength(3);
    expect(SHOT_TIERS.nuke.id).toBe('nuke');
  });
  it('exposes the spike tunables as one frozen object', () => {
    expect(Object.isFrozen(INVADERS_TUNABLES)).toBe(true);
    expect(INVADERS_TUNABLES).toMatchObject({ fireIntervalS: expect.any(Number), aimLatchMs: expect.any(Number), poseModelType: expect.stringMatching(/^(lite|full)$/) });
  });
  it('carries the garage fire rate measured in Phase 0', () => {
    expect(INVADERS_TUNABLES.fireIntervalS).toBe(1.0);
  });
});
