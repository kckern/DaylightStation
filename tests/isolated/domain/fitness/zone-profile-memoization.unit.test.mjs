import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Mock the logger to avoid import issues in test
jest.unstable_mockModule('../../../../frontend/src/lib/logging/Logger.js', () => ({
  default: () => ({
    sampled: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
  __esModule: true,
}));

describe('ZoneProfileStore.syncFromUsers memoization', () => {
  let ZoneProfileStore;
  let store;
  const baseZoneConfig = [
    { id: 'cool', name: 'Cool', color: 'blue', min: 0 },
    { id: 'warm', name: 'Warm', color: 'yellow', min: 100 },
    { id: 'active', name: 'Active', color: 'orange', min: 120 },
    { id: 'hot', name: 'Hot', color: 'red', min: 150 },
  ];

  const makeUser = (id, hr) => ({
    id,
    name: id,
    currentData: { heartRate: hr },
    zoneConfig: null,
  });

  beforeEach(async () => {
    const mod = await import('../../../../frontend/src/hooks/fitness/ZoneProfileStore.js');
    ZoneProfileStore = mod.ZoneProfileStore;
    store = new ZoneProfileStore();
    store.setBaseZoneConfig(baseZoneConfig);
  });

  it('returns true on first sync (profiles changed)', () => {
    const users = [makeUser('alice', 110)];
    expect(store.syncFromUsers(users)).toBe(true);
  });

  it('returns false on repeated sync with identical inputs', () => {
    const users = [makeUser('alice', 110)];
    store.syncFromUsers(users);
    expect(store.syncFromUsers(users)).toBe(false);
  });

  it('returns true when HR changes', () => {
    store.syncFromUsers([makeUser('alice', 110)]);
    expect(store.syncFromUsers([makeUser('alice', 130)])).toBe(true);
  });

  it('uses cache when inputs are identical (cache populated)', () => {
    const users = [makeUser('alice', 110)];
    store.syncFromUsers(users);

    // After first sync, cache should have 1 entry
    expect(store._profileCache.size).toBe(1);

    // Second sync with same data should still have 1 entry (no growth)
    store.syncFromUsers(users);
    expect(store._profileCache.size).toBe(1);
  });

  it('clears cache on clear()', () => {
    store.syncFromUsers([makeUser('alice', 110)]);
    expect(store._profileCache.size).toBe(1);
    store.clear();
    expect(store._profileCache.size).toBe(0);
  });
});
