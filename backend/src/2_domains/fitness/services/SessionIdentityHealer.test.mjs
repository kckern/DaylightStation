import { describe, it, expect } from 'vitest';
import { planHeal, isKnownUserId, discoverOccupantIds, occupantEffort, isInsignificant, DEFAULT_CFG } from './SessionIdentityHealer.mjs';

describe('discoverOccupantIds', () => {
  it('finds flat <id>:hr keys, excludes device/vib/bike/global namespaces', () => {
    const series = {
      'elizabeth:hr': '[]',
      'grannie:hr': '[]',
      'device:29413:hr': '[]',
      'vib:punching-bag:hr': '[]',
      'bike:7138:hr': '[]',
      'global:hr': '[]'
    };
    const ids = discoverOccupantIds(series);
    expect([...ids].sort()).toEqual(['elizabeth', 'grannie']);
  });
});

describe('isKnownUserId', () => {
  it('rejects synthetic guest ids, accepts configured ids', () => {
    expect(isKnownUserId('grannie')).toBe(true);
    expect(isKnownUserId('guest-123')).toBe(false);
    expect(isKnownUserId('#90006')).toBe(false);
    expect(isKnownUserId('guest_29413')).toBe(false);
  });
});

describe('occupantEffort + isInsignificant', () => {
  it('computes coins (last non-null), active/warm/hot zone seconds, hr sample count', () => {
    const decoded = {
      'a:hr': [null, 120, 0, 130, null],
      'a:zone': [null, 'a', 'c', 'w', 'h'],
      'a:coins': [0, 1, 3, 3, 3]
    };
    const effort = occupantEffort(decoded, 'a', 5);
    expect(effort).toEqual({ coins: 3, activeWarmZoneSeconds: 15, hrSampleCount: 2 });
  });

  it('is insignificant for a near-idle strap regardless of duration', () => {
    expect(isInsignificant({ coins: 1, activeWarmZoneSeconds: 0, hrSampleCount: 2 }, DEFAULT_CFG)).toBe(true);
  });

  it('is not insignificant when any bound is exceeded', () => {
    expect(isInsignificant({ coins: 5, activeWarmZoneSeconds: 0, hrSampleCount: 2 })).toBe(false);
    expect(isInsignificant({ coins: 0, activeWarmZoneSeconds: 30, hrSampleCount: 2 })).toBe(false);
    expect(isInsignificant({ coins: 0, activeWarmZoneSeconds: 0, hrSampleCount: 50 })).toBe(false);
  });
});

describe('planHeal — insignificant occupant removal', () => {
  it('removes a 1-sample/0-coin ghost, keeps the substantial occupant', () => {
    const session = {
      entities: [
        { deviceId: '29413', profileId: 'elizabeth', startTime: 0, endTime: 5000, status: 'active' },
        { deviceId: '29413', profileId: 'grannie', startTime: 5000, endTime: 10000, status: 'active' }
      ],
      timeline: {
        interval_seconds: 5,
        series: {
          'elizabeth:hr': [116, null],
          'elizabeth:coins': [0, 0],
          'grannie:hr': [80, 90],
          'grannie:coins': [5, 10],
          'grannie:zone': ['a', 'w']
        }
      }
    };

    const result = planHeal(session);

    expect([...result.removedOccupants].sort()).toEqual(['elizabeth']);
    expect(result.needsHeal).toBe(true);
    expect(result.transfers).toContainEqual({ from: 'elizabeth', to: 'grannie', reason: 'insignificant-forward' });
    expect(result.merges).toEqual([]);
  });

  it('is a no-op (needsHeal:false) when every occupant carries substantial effort', () => {
    const session = {
      entities: [
        { deviceId: 'D1', profileId: 'grannie', startTime: 0, endTime: 10000, status: 'active' }
      ],
      timeline: {
        interval_seconds: 5,
        series: {
          'grannie:hr': [80, 90, 100, 110],
          'grannie:coins': [5, 10, 15, 20],
          'grannie:zone': ['a', 'w', 'h', 'h']
        }
      }
    };

    const result = planHeal(session);

    expect(result.removedOccupants).toEqual([]);
    expect(result.transfers).toEqual([]);
    expect(result.merges).toEqual([]);
    expect(result.needsHeal).toBe(false);
  });
});

describe('planHeal — known-user two-device split merge', () => {
  it('merges a strap-swap recorded under two ids into one, via known_user_aliases', () => {
    const session = {
      entities: [
        { deviceId: 'D1', profileId: 'kckern', startTime: 0, endTime: 60000, status: 'active' },
        { deviceId: 'D2', profileId: 'kckern_alt', startTime: 60000, endTime: null, status: 'active' }
      ],
      timeline: {
        interval_seconds: 5,
        series: {
          'kckern:hr': [120, 121, null, null],
          'kckern:coins': [1, 2, 2, 2],
          'kckern_alt:hr': [null, null, 130, 131],
          'kckern_alt:coins': [3, 4, 10, 20]
        }
      }
    };

    const result = planHeal(session, { known_user_aliases: { kckern_alt: 'kckern' } });

    expect(result.merges).toContainEqual({ from: 'kckern_alt', to: 'kckern', reason: 'known-user-device-swap' });
    expect(result.removedOccupants).toEqual(['kckern_alt']);
    expect(result.needsHeal).toBe(true);
  });

  it('does not merge unaliased known users on different devices (nothing to rename)', () => {
    const session = {
      entities: [
        { deviceId: 'D1', profileId: 'kckern', startTime: 0, endTime: 60000, status: 'active' },
        { deviceId: 'D2', profileId: 'kckern', startTime: 60000, endTime: null, status: 'active' }
      ],
      timeline: {
        interval_seconds: 5,
        series: {
          'kckern:hr': [120, 121, 122, 123],
          'kckern:coins': [10, 20, 30, 40]
        }
      }
    };

    const result = planHeal(session);

    expect(result.merges).toEqual([]);
    expect(result.removedOccupants).toEqual([]);
    expect(result.needsHeal).toBe(false);
  });
});

describe('planHeal — series-only occupant discovery + successor fallback', () => {
  it('folds a series-only ghost (no entity) into the sole device occupant', () => {
    const session = {
      entities: [
        { deviceId: '29413', profileId: 'grannie', startTime: 400, endTime: null, status: 'active' }
      ],
      timeline: {
        interval_seconds: 5,
        series: {
          'soren:hr': [116, 116, null],
          'grannie:hr': [null, null, 80],
          'grannie:coins': [1, 2, 10]
        }
      }
    };

    const result = planHeal(session);

    expect(result.removedOccupants).toEqual(['soren']);
    expect(result.transfers).toContainEqual({ from: 'soren', to: 'grannie', reason: expect.stringMatching(/insignificant-/) });
  });
});

describe('planHeal — RLE-encoded on-disk series (decode integration)', () => {
  it('decodes RLE-encoded strings via TimelineService before computing effort', () => {
    const session = {
      entities: [
        { deviceId: 'D1', profileId: 'elizabeth', startTime: 0, endTime: 5000, status: 'active' },
        { deviceId: 'D1', profileId: 'grannie', startTime: 5000, endTime: 10000, status: 'active' }
      ],
      timeline: {
        interval_seconds: 5,
        series: {
          // RLE: [116, 1] then null x1 -> one 116, one null
          'elizabeth:hr': JSON.stringify([116, null]),
          'elizabeth:coins': JSON.stringify([[0, 2]]),
          'grannie:hr': JSON.stringify([[85, 4]]),
          'grannie:coins': JSON.stringify([[20, 4]]),
          'grannie:zone': JSON.stringify([['a', 4]])
        }
      }
    };

    const result = planHeal(session);

    expect(result.removedOccupants).toEqual(['elizabeth']);
    expect(result.needsHeal).toBe(true);
  });
});
