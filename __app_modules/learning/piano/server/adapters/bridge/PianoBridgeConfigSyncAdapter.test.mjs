import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PianoBridgeConfigSyncAdapter, configDrift, wantedBridgeConfig } from './PianoBridgeConfigSyncAdapter.mjs';

const quiet = { debug() {}, info() {}, warn() {}, error() {} };

function bridge(values) {
  const posts = [];
  const fetchImpl = async (url, opts = {}) => {
    if (opts.method === 'POST') { posts.push(opts.body); return { ok: true, json: async () => ({ ok: true }) }; }
    return { ok: true, json: async () => ({ values }) };
  };
  return { posts, fetchImpl };
}

test('wanted config comes from the registry entry the bridge dials', () => {
  const wanted = wantedBridgeConfig({
    deviceId: 'room-tablet',
    midiDevice: { bluetooth: { name: 'midi-relay-01', address: 'aa:bb:cc:00:10:01' } },
    deviceConfig: { heartbeatLogStoreUrl: 'http://logs.example:9428/insert', nested: { no: 1 } },
  });
  assert.deepEqual(wanted, {
    heartbeatLogStoreUrl: 'http://logs.example:9428/insert',
    heartbeatDeviceId: 'room-tablet',
    targetName: 'midi-relay-01',
    targetMac: 'AA:BB:CC:00:10:01',
  });
});

test('drift ignores empty wanted values and compares as strings', () => {
  assert.deepEqual(configDrift({ a: '1', b: 'x' }, { a: 1, b: 'y', c: '' }), ['b']);
});

test('in sync: nothing is posted', async () => {
  const b = bridge({ targetName: 'midi-relay-01' });
  const sync = new PianoBridgeConfigSyncAdapter({ bridgeUrl: 'ws://t:8770', wanted: { targetName: 'midi-relay-01' }, checkIdle: async () => ({ idle: true }), fetchImpl: b.fetchImpl, logger: quiet });
  assert.equal((await sync.reconcile()).status, 'in-sync');
  assert.equal(b.posts.length, 0);
});

test('drift on an idle kiosk is merged onto every existing key', async () => {
  const b = bridge({ targetMac: 'AA:BB:CC:00:10:01', fkbPassword: 'keep-me', targetName: 'old' });
  const sync = new PianoBridgeConfigSyncAdapter({ bridgeUrl: 'http://t:8770/', wanted: { targetName: 'midi-relay-01', heartbeatDeviceId: 'room-tablet' }, checkIdle: async () => ({ idle: true }), fetchImpl: b.fetchImpl, logger: quiet });
  const r = await sync.reconcile();
  assert.equal(r.status, 'pushed');
  assert.deepEqual(r.keys, ['targetName', 'heartbeatDeviceId']);
  assert.equal(b.posts[0], 'targetMac: AA:BB:CC:00:10:01\nfkbPassword: keep-me\ntargetName: midi-relay-01\nheartbeatDeviceId: room-tablet\n');
});

test('a busy kiosk, or no idle check at all, defers the push', async () => {
  const b = bridge({});
  const busy = new PianoBridgeConfigSyncAdapter({ bridgeUrl: 'http://t', wanted: { targetName: 'x' }, checkIdle: async () => ({ idle: false, reason: 'game' }), fetchImpl: b.fetchImpl, logger: quiet });
  assert.deepEqual(await busy.reconcile(), { status: 'deferred', keys: ['targetName'], reason: 'game' });
  const blind = new PianoBridgeConfigSyncAdapter({ bridgeUrl: 'http://t', wanted: { targetName: 'x' }, fetchImpl: b.fetchImpl, logger: quiet });
  assert.equal((await blind.reconcile()).reason, 'no-idle-check');
  assert.equal(b.posts.length, 0);
});

test('never pushes twice inside the gap, even if the bridge did not take it', async () => {
  let t = 0;
  const b = bridge({});
  const sync = new PianoBridgeConfigSyncAdapter({ bridgeUrl: 'http://t', wanted: { targetName: 'x' }, checkIdle: async () => ({ idle: true }), fetchImpl: b.fetchImpl, logger: quiet, now: () => t, minPushGapMs: 1000 });
  assert.equal((await sync.reconcile()).status, 'pushed');
  t = 500;
  assert.equal((await sync.reconcile()).reason, 'recent-push');
  t = 1500;
  assert.equal((await sync.reconcile()).status, 'pushed');
  assert.equal(b.posts.length, 2);
});

test('an unreadable config is left alone', async () => {
  const sync = new PianoBridgeConfigSyncAdapter({ bridgeUrl: 'http://t', wanted: { targetName: 'x' }, checkIdle: async () => ({ idle: true }), fetchImpl: async () => ({ ok: false, status: 500 }), logger: quiet });
  assert.equal((await sync.reconcile()).status, 'unreadable');
});
