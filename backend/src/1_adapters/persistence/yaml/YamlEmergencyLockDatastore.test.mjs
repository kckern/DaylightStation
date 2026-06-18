import { test } from 'node:test';
import assert from 'node:assert/strict';
import { YamlEmergencyLockDatastore } from './YamlEmergencyLockDatastore.mjs';
import { LockdownState } from '#domains/fitness/value-objects/LockdownState.mjs';

function makeStore() {
  const files = new Map();
  const configService = {
    getHouseholdPath: (rel, hid) => `/data/household${hid ? `-${hid}` : ''}/${rel}`,
  };
  const store = new YamlEmergencyLockDatastore({
    configService,
    load: (p) => (files.has(p) ? files.get(p) : null),
    save: (p, content) => { files.set(p, content); },
    remove: (p) => { files.delete(p); },
  });
  return { store, files };
}

test('save then load round-trips a LockdownState', async () => {
  const { store, files } = makeStore();
  const state = LockdownState.create({ lockedBy: 'alice', durationSec: 1800, now: 1000 });
  await store.save(state);
  // Persisted under the household path
  assert.equal(files.has('/data/household/history/fitness/emergency_lock.yml'), true);
  const loaded = await store.load();
  assert.deepEqual(loaded.toData(), state.toData());
});

test('load returns null when file is absent', async () => {
  const { store } = makeStore();
  assert.equal(await store.load(), null);
});

test('clear deletes the record so load returns null', async () => {
  const { store } = makeStore();
  await store.save(LockdownState.create({ lockedBy: 'bob', durationSec: 60, now: 500 }));
  await store.clear();
  assert.equal(await store.load(), null);
});

test('load returns null for a corrupt/partial record', async () => {
  const { store, files } = makeStore();
  files.set('/data/household/history/fitness/emergency_lock.yml', { lockedBy: 'x' }); // missing times
  assert.equal(await store.load(), null);
});

test('constructor requires configService with getHouseholdPath', () => {
  assert.throws(() => new YamlEmergencyLockDatastore({ configService: {} }), /getHouseholdPath/);
});
