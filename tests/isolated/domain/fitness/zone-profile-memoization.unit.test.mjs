import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the logger to avoid import issues in test
vi.mock('../../../../frontend/src/lib/logging/Logger.js', () => ({
  default: () => ({
    sampled: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
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

    // After first sync, cache should have 1 entry (keyed with committedZone '_none_')
    expect(store._profileCache.size).toBe(1);

    // Second sync: hysteresis has now committed a zone, so the cache key changes
    // (committedZone shifts from '_none_' to the actual zone). This is correct —
    // the key must include committed zone to avoid skipping #applyHysteresis().
    store.syncFromUsers(users);
    expect(store._profileCache.size).toBe(2);

    // Third sync: committed zone is stable, so the key matches the second entry — cache hit
    store.syncFromUsers(users);
    expect(store._profileCache.size).toBe(2);
  });

  it('clears cache on clear()', () => {
    store.syncFromUsers([makeUser('alice', 110)]);
    expect(store._profileCache.size).toBe(1);
    store.clear();
    expect(store._profileCache.size).toBe(0);
  });
});
