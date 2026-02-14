import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';

// Mock logger
const mockSampled = jest.fn();
const mockInfo = jest.fn();
const mockWarn = jest.fn();
const mockDebug = jest.fn();
const mockError = jest.fn();
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({ sampled: mockSampled, info: mockInfo, warn: mockWarn, debug: mockDebug, error: mockError }),
  getLogger: () => ({ sampled: mockSampled, info: mockInfo, warn: mockWarn, debug: mockDebug, error: mockError })
}));

const { ZoneProfileStore } = await import('#frontend/hooks/fitness/ZoneProfileStore.js');

const ZONE_CONFIG = [
  { id: 'cool', name: 'Cool', min: 0, color: 'gray', coins: 0 },
  { id: 'active', name: 'Active', min: 100, color: 'green', coins: 1 },
  { id: 'warm', name: 'Warm', min: 130, color: 'yellow', coins: 2 },
  { id: 'hot', name: 'Hot', min: 160, color: 'orange', coins: 3 }
];

const makeUser = (id, heartRate, opts = {}) => ({
  id,
  name: opts.name || id,
  displayName: opts.displayName || id,
  currentData: { heartRate },
  zoneConfig: opts.zoneConfig || null,
  source: 'test'
});

describe('ZoneProfileStore hysteresis', () => {
  let store;
  let realDateNow;
  let mockTime;

  beforeEach(() => {
    mockSampled.mockClear();
    mockInfo.mockClear();
    mockWarn.mockClear();
    mockDebug.mockClear();
    mockError.mockClear();
    store = new ZoneProfileStore();
    store.setBaseZoneConfig(ZONE_CONFIG);
    realDateNow = Date.now;
    mockTime = realDateNow.call(Date);
    Date.now = () => mockTime;
  });

  afterEach(() => {
    Date.now = realDateNow;
  });

  test('first zone assignment is instant (no delay)', () => {
    store.syncFromUsers([makeUser('user-1', 110)]); // active zone
    const profile = store.getProfile('user-1');
    expect(profile.currentZoneId).toBe('active');
  });

  test('zone transitions after cooldown period are instant', () => {
    // First sync: active zone
    store.syncFromUsers([makeUser('user-1', 110)]);
    expect(store.getProfile('user-1').currentZoneId).toBe('active');

    // Advance past cooldown (5000ms)
    mockTime += 6000;

    // Second sync: warm zone — should commit instantly (outside cooldown)
    store.syncFromUsers([makeUser('user-1', 140)]);
    expect(store.getProfile('user-1').currentZoneId).toBe('warm');
  });

  test('rapid toggling within cooldown holds committed zone', () => {
    // First sync: active zone
    store.syncFromUsers([makeUser('user-1', 110)]);
    expect(store.getProfile('user-1').currentZoneId).toBe('active');

    // 100ms later: HR crosses into warm
    mockTime += 100;
    store.syncFromUsers([makeUser('user-1', 140)]);
    // Within cooldown, but this is the first change — should commit
    // (Actually, within 5s of last commit, so this is rapid toggling)
    // The first transition is at t=0. 100ms later is within cooldown.
    // New zone must be stable for HYSTERESIS_STABILITY_MS (3000ms)
    // Since raw just changed, not stable yet → keep active
    expect(store.getProfile('user-1').currentZoneId).toBe('active');

    // 200ms later: HR drops back to active
    mockTime += 200;
    store.syncFromUsers([makeUser('user-1', 110)]);
    // Back to committed zone — shows as active (committed)
    expect(store.getProfile('user-1').currentZoneId).toBe('active');

    // 100ms later: HR crosses into warm again
    mockTime += 100;
    store.syncFromUsers([makeUser('user-1', 140)]);
    // Still within cooldown, raw just changed again → not stable → keep active
    expect(store.getProfile('user-1').currentZoneId).toBe('active');
  });

  test('new zone commits after stability period within cooldown', () => {
    // First sync: active zone
    store.syncFromUsers([makeUser('user-1', 110)]);
    expect(store.getProfile('user-1').currentZoneId).toBe('active');

    // 100ms later: HR crosses into warm
    mockTime += 100;
    store.syncFromUsers([makeUser('user-1', 140)]);
    expect(store.getProfile('user-1').currentZoneId).toBe('active'); // Not stable yet

    // Warm stays stable for 3000ms (HYSTERESIS_STABILITY_MS)
    mockTime += 3000;
    store.syncFromUsers([makeUser('user-1', 140)]);
    // Now raw warm has been stable for 3100ms (since t+100) ≥ 3000ms → commits
    expect(store.getProfile('user-1').currentZoneId).toBe('warm');
  });

  test('HR value 0 maps to first zone (no fallback to stale data)', () => {
    // After SSoT fix: HR 0 means no fallback, just first zone
    store.syncFromUsers([makeUser('user-1', 0)]);
    const profile = store.getProfile('user-1');
    // HR=0 should be in cool zone (min: 0)
    expect(profile.heartRate).toBe(0);
    expect(profile.currentZoneId).toBe('cool');
  });

  test('missing HR (NaN/undefined) defaults to 0 heartRate', () => {
    store.syncFromUsers([{
      id: 'user-1',
      name: 'user-1',
      displayName: 'user-1',
      currentData: { heartRate: undefined },
      source: 'test'
    }]);
    const profile = store.getProfile('user-1');
    expect(profile.heartRate).toBe(0);
  });

  test('profile returns stabilized zone, not raw snapshot zone', () => {
    // First sync: active
    store.syncFromUsers([makeUser('user-1', 110)]);

    // Quick zone change during cooldown
    mockTime += 100;
    store.syncFromUsers([makeUser('user-1', 140)]); // raw: warm

    const profile = store.getProfile('user-1');
    // currentZoneId should be stabilized (active), not raw (warm)
    expect(profile.currentZoneId).toBe('active');
    // But the raw snapshot should show warm
    expect(profile.zoneSnapshot?.currentZoneId).toBe('warm');
  });

  test('getZoneState returns stabilized zone matching getProfile', () => {
    store.syncFromUsers([makeUser('user-1', 110)]);

    // Quick change during cooldown
    mockTime += 100;
    store.syncFromUsers([makeUser('user-1', 140)]);

    const profile = store.getProfile('user-1');
    const zoneState = store.getZoneState('user-1');

    // Both should return stabilized zone
    expect(zoneState.zoneId).toBe(profile.currentZoneId);
    expect(zoneState.zoneId).toBe('active'); // Stabilized, not raw warm
  });
});
