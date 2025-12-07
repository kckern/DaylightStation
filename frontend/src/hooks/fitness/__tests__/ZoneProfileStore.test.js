import test from 'node:test';
import assert from 'node:assert/strict';
import { ZoneProfileStore } from '../ZoneProfileStore.js';

const DEFAULT_ZONES = [
  { id: 'cool', name: 'Cool', min: 80, color: 'blue' },
  { id: 'active', name: 'Active', min: 100, color: 'green' },
  { id: 'warm', name: 'Warm', min: 120, color: 'yellow' },
  { id: 'hot', name: 'Hot', min: 140, color: 'orange' }
];

const createUser = ({ name = 'Guest', heartRate = 95, zoneConfig = DEFAULT_ZONES } = {}) => ({
  name,
  id: name.toLowerCase(),
  groupLabel: 'Test',
  source: 'Primary',
  zoneConfig,
  currentData: {
    heartRate,
    zone: null,
    zoneName: null,
    color: null
  }
});

test('ZoneProfileStore syncs users into normalized profiles', () => {
  const store = new ZoneProfileStore();
  store.setBaseZoneConfig(DEFAULT_ZONES);

  const updated = store.syncFromUsers([
    createUser({ name: 'Alex', heartRate: 110 })
  ]);

  assert.equal(updated, true);
  const profiles = store.getProfiles();
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].slug, 'alex');
  assert.ok(profiles[0].currentZoneId);
  assert.ok(Array.isArray(profiles[0].zoneSequence));
});

test('ZoneProfileStore exposes derived zone state snapshots', () => {
  const store = new ZoneProfileStore();
  store.setBaseZoneConfig(DEFAULT_ZONES);
  store.syncFromUsers([
    createUser({ name: 'Jamie', heartRate: 135 })
  ]);

  const state = store.getZoneState('Jamie');
  assert.ok(state);
  assert.equal(state.slug, 'jamie');
  assert.equal(state.zoneId, state.zoneId?.toLowerCase());
  assert.ok(Number.isFinite(state.currentZoneThreshold) || state.currentZoneThreshold === null);
});

test('getProfile returns defensive clones', () => {
  const store = new ZoneProfileStore();
  store.setBaseZoneConfig(DEFAULT_ZONES);
  store.syncFromUsers([
    createUser({ name: 'Riley', heartRate: 90 })
  ]);

  const profile = store.getProfile('Riley');
  assert.ok(profile);
  profile.zoneConfig[0].min = 999; // mutate clone
  const untouched = store.getProfile('Riley');
  assert.notEqual(untouched.zoneConfig[0].min, 999);
});
