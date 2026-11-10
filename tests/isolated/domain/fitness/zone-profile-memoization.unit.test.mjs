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
  // Canonical intensity order: cool < active < warm < hot. This fixture used to
  // have warm(100) sitting BELOW active(120) — an inverted ladder, which
  // validateZoneLadder now rejects, leaving the rider with no committed zone
  // and nothing to memoize. The ordering is incidental to what this file tests.
  const baseZoneConfig = [
    { id: 'cool', name: 'Cool', color: 'blue', min: 0 },
    { id: 'active', name: 'Active', color: 'green', min: 100 },
    { id: 'warm', name: 'Warm', color: 'yellow', min: 120 },
    { id: 'hot', name: 'Hot', color: 'orange', min: 150 },
  ];

  const makeUser = (id, hr) => ({
    id,
    name: id,
    currentData: { heartRate: hr },
    zoneConfig: null,
  });

  beforeEach(async () => {
    const mod = await import("../../../../__app_modules/wellness/fitness/browser/hooks/fitness/ZoneProfileStore.js");
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

  // The profile cache is gone on purpose (7e98604f22): it skipped raw-zone
  // changes and stability expiry on a repeated heart rate. A repeated reading
  // must still advance the state machine, while the return value keeps
  // telling consumers nothing changed.
  it('still advances the zone state on a repeated reading, while reporting no change', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(100000);
      store.syncFromUsers([makeUser('alice', 90)]);
      vi.setSystemTime(106000);
      store.syncFromUsers([makeUser('alice', 110)]);
      expect(store.getProfile('alice').currentZoneId).toBe('cool');
      vi.setSystemTime(107000);
      store.syncFromUsers([makeUser('alice', 110)]);
      expect(store.getProfile('alice').currentZoneId).toBe('active');
    } finally {
      vi.useRealTimers();
    }
  });
});
