import { describe, test, expect, beforeEach } from '@jest/globals';
import { ZoneProfileStore } from '../../../../frontend/src/hooks/fitness/ZoneProfileStore.js';

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

describe('ZoneProfileStore displayZoneId', () => {
  let store;

  beforeEach(() => {
    store = new ZoneProfileStore();
    store.setBaseZoneConfig(ZONE_CONFIG);
  });

  test('displayZoneId matches currentZoneId on first sync', () => {
    store.syncFromUsers([makeUser('alice', 130)]);
    const profile = store.getProfile('alice');
    expect(profile.currentZoneId).toBe('active');
    expect(profile.displayZoneId).toBe('active');
  });

  test('displayZoneId shows raw zone during exit margin suppression', () => {
    // First: establish committed zone as 'active' (HR=130)
    store.syncFromUsers([makeUser('alice', 130)]);
    let profile = store.getProfile('alice');
    expect(profile.currentZoneId).toBe('active');

    // Now: drop HR to 118 (below active min 120, but above exit threshold 115)
    store.syncFromUsers([makeUser('alice', 118)]);
    profile = store.getProfile('alice');

    // currentZoneId stays 'active' (exit margin suppression)
    expect(profile.currentZoneId).toBe('active');
    // displayZoneId should show 'cool' (the raw HR-derived zone)
    expect(profile.displayZoneId).toBe('cool');
  });

  test('getZoneState includes displayZoneId', () => {
    store.syncFromUsers([makeUser('alice', 130)]);
    const state = store.getZoneState('alice');
    expect(state.displayZoneId).toBeDefined();
    expect(state.displayZoneId).toBe('active');
  });
});
