import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { ZoneProfileStore } from "../../../../__app_modules/wellness/fitness/browser/hooks/fitness/ZoneProfileStore.js";

const ZONE_CONFIG = [
  { id: 'cool', name: 'Cool', color: '#3b82f6', min: 0 },
  { id: 'active', name: 'Active', color: '#22c55e', min: 120 },
  { id: 'warm', name: 'Warm', color: '#f59e0b', min: 140 },
  { id: 'hot', name: 'Hot', color: '#ef4444', min: 160 }
];

function makeUser(id, heartRate) {
  return {
    id,
    name: id,
    zoneConfig: ZONE_CONFIG,
    currentData: { heartRate }
  };
}

// A rider's zone is earned: a real Cool reading admits them, and an upward
// change needs a second confirming sample (see ZoneProfileStore.startupTrust).
describe('ZoneProfileStore displayZoneId', () => {
  let store;
  const advance = (ms) => vi.setSystemTime(Date.now() + ms);
  const sync = (hr) => { store.syncFromUsers([makeUser('alice', hr)]); return store.getProfile('alice'); };
  const climbTo = (hr) => { sync(90); advance(6000); sync(hr); advance(1000); return sync(hr); };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(100000);
    store = new ZoneProfileStore();
    store.setBaseZoneConfig(ZONE_CONFIG);
  });
  afterEach(() => vi.useRealTimers());

  test('shows the raw zone before trust, without publishing it as the committed zone', () => {
    const profile = sync(130);
    expect(profile.currentZoneId).toBeNull();
    expect(profile.displayZoneId).toBe('active');
  });

  test('displayZoneId matches currentZoneId once the climb is confirmed', () => {
    const profile = climbTo(130);
    expect(profile.currentZoneId).toBe('active');
    expect(profile.displayZoneId).toBe('active');
  });

  test('displayZoneId shows raw zone during exit margin suppression', () => {
    let profile = climbTo(130);
    expect(profile.currentZoneId).toBe('active');

    // Now: drop HR to 118 (below active min 120, but above exit threshold 115)
    advance(1000);
    profile = sync(118);

    // currentZoneId stays 'active' (exit margin suppression)
    expect(profile.currentZoneId).toBe('active');
    // displayZoneId should show 'cool' (the raw HR-derived zone)
    expect(profile.displayZoneId).toBe('cool');
  });

  test('getZoneState includes displayZoneId', () => {
    climbTo(130);
    const state = store.getZoneState('alice');
    expect(state.displayZoneId).toBe('active');
  });
});
