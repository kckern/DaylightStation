import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PianoWakeHoldSyncAdapter } from './PianoWakeHoldSyncAdapter.mjs';

const NOW = 1_800_000_000_000;
const noLog = { debug() {}, info() {}, warn() {}, error() {} };

/** A device whose power.wakeSuppressUntilSec is `value`; records every request. */
function device(value, { failPost = false, failGet = false } = {}) {
  const state = { value, calls: [] };
  const fetchImpl = async (url, init = {}) => {
    state.calls.push({ method: init.method, url, body: init.body ? JSON.parse(init.body) : null, token: init.headers?.['X-Daylight-Token'], signal: !!init.signal });
    if (init.method === 'GET') {
      if (failGet) throw new Error('ECONNREFUSED');
      return { ok: true, status: 200, json: async () => ({ ok: true, settings: [{ key: 'power.wakeSuppressUntilSec', value: state.value }] }) };
    }
    if (failPost) return { ok: false, status: 500, json: async () => ({ ok: false, error: 'internal' }) };
    state.value = JSON.parse(init.body).value;
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  return { state, fetchImpl };
}
const make = (dev, override) => new PianoWakeHoldSyncAdapter({
  baseUrl: 'http://tablet.invalid:8780', headers: { 'X-Daylight-Token': 'tok' }, deviceId: 'yellow-room-tablet',
  overrides: { get: () => override, hasDecision: () => true }, now: () => NOW, fetchImpl: dev.fetchImpl, logger: noLog,
});

test('after a recorded release a stale tablet deadline is cleared with 0', async () => {
  const dev = device(Math.ceil(NOW / 1000) + 3600);
  const sync = make(dev, null);
  assert.deepEqual(await sync.reconcile(), { checked: true, wrote: 0 });
  assert.equal(dev.state.value, 0);
  assert.deepEqual(dev.state.calls.map((c) => c.method), ['GET', 'POST']);
  assert.ok(dev.state.calls.every((c) => c.token === 'tok' && c.signal));
});

test('with an off hold in the backend, its deadline is written', async () => {
  const dev = device(0);
  const sync = make(dev, { state: 'off', until: NOW + 20 * 60_000 });
  await sync.reconcile();
  assert.equal(dev.state.value, Math.ceil((NOW + 20 * 60_000) / 1000));
});

test('a tablet that already agrees is only read', async () => {
  const dev = device(0);
  await make(dev, null).reconcile();
  const past = device(Math.ceil(NOW / 1000) - 60);
  await make(past, null).reconcile();
  assert.deepEqual(dev.state.calls.map((c) => c.method), ['GET']);
  assert.deepEqual(past.state.calls.map((c) => c.method), ['GET'], 'a deadline already passed holds nothing');
  const on = device(0);
  await make(on, { state: 'on', until: NOW + 60_000 }).reconcile();
  assert.deepEqual(on.state.calls.map((c) => c.method), ['GET'], 'an on hold is not a wake suppression');
});

test('it checks once after boot, then only after a failed relay, and retries that once', async () => {
  const dev = device(Math.ceil(NOW / 1000) + 600);
  const sync = make(dev, null);
  assert.equal((await sync.reconcile()).checked, true, 'the first reachable tick after boot');
  assert.equal((await sync.reconcile()).checked, false, 'nothing to do afterwards');
  sync.relayFailed();
  assert.equal((await sync.reconcile()).checked, true, 'the tick after a failed relay');
  assert.equal((await sync.reconcile()).checked, false, 'retried once, not every tick');
});

test('a failed resync is logged, not thrown, and is tried again on the next tick', async () => {
  const errors = [];
  const dev = device(Math.ceil(NOW / 1000) + 600, { failPost: true });
  const sync = new PianoWakeHoldSyncAdapter({
    baseUrl: 'http://tablet.invalid:8780', deviceId: 'yellow-room-tablet', overrides: { get: () => null },
    now: () => NOW, fetchImpl: dev.fetchImpl, logger: { ...noLog, error: (e, d) => errors.push([e, d]) },
  });
  assert.deepEqual(await sync.reconcile(), { checked: true, wrote: null, error: 'HTTP 500' });
  assert.equal(errors[0][0], 'piano-wake-hold.resync-failed');
  assert.equal((await sync.reconcile()).checked, true, 'retried on the next reachable tick');
});

test('a hold relayed while the GET is in flight is written, not overwritten with the value from before it', async () => {
  let override = null;
  const posted = [];
  const fetchImpl = async (url, init = {}) => {
    if (init.method === 'GET') {
      // A manual hold arrives while the device is being read.
      override = { state: 'off', until: NOW + 30 * 60_000 };
      return { ok: true, status: 200, json: async () => ({ ok: true, settings: [{ key: 'power.wakeSuppressUntilSec', value: Math.ceil(NOW / 1000) + 600 }] }) };
    }
    posted.push(JSON.parse(init.body).value);
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const sync = new PianoWakeHoldSyncAdapter({
    baseUrl: 'http://tablet.invalid:8780', deviceId: 'yellow-room-tablet', overrides: { get: () => override },
    now: () => NOW, fetchImpl, logger: noLog,
  });
  await sync.reconcile();
  assert.deepEqual(posted, [Math.ceil((NOW + 30 * 60_000) / 1000)]);
});

test('a failed re-sync is tried again on the next reachable tick', async () => {
  let fail = true;
  const dev = device(Math.ceil(NOW / 1000) + 600);
  const fetchImpl = async (url, init = {}) => {
    if (fail) { fail = false; throw new Error('ECONNRESET'); }
    return dev.fetchImpl(url, init);
  };
  const sync = new PianoWakeHoldSyncAdapter({
    baseUrl: 'http://tablet.invalid:8780', deviceId: 'yellow-room-tablet', overrides: { get: () => null },
    now: () => NOW, fetchImpl, logger: noLog,
  });
  assert.equal((await sync.reconcile()).error, 'ECONNRESET');
  assert.deepEqual(await sync.reconcile(), { checked: true, wrote: 0 });
  assert.equal(dev.state.value, 0);
  assert.equal((await sync.reconcile()).checked, false, 'once it has succeeded there is nothing left to do');
});

import { ScreenOverrideService } from '../../../../../../__backend/src/3_applications/devices/services/ScreenOverrideService.mjs';
import { DeviceScreenControlService } from '../../../../../../__backend/src/3_applications/devices/services/DeviceScreenControlService.mjs';
import { PianoMidiWakeService } from '../../application/services/PianoMidiWakeService.mjs';
import { PianoMidiBridgeAdapter } from './PianoMidiBridgeAdapter.mjs';

test('manual off survives a backend restart before first note, release during outage wins after restart, and holds expire', async () => {
  const dev = device(0);
  const id = 'piano-tablet';
  let now = NOW, online = true, saved = null, wakes = 0;
  const clock = { now: () => now };
  const store = { deviceId: id, load: () => saved, save: value => { saved = structuredClone(value); } };
  const fetchImpl = (...args) => online ? dev.fetchImpl(...args) : Promise.reject(Error('offline'));
  const devices = { get: () => ({ setScreen: async (on) => { if (on) wakes++; return { ok: true }; } }) };
  function boot() {
    const overrides = new ScreenOverrideService({ clock, store });
    const sync = new PianoWakeHoldSyncAdapter({ baseUrl: 'http://fixture.invalid', deviceId: id, overrides, now: clock.now, fetchImpl, logger: noLog });
    const bridge = new PianoMidiBridgeAdapter({ bridgeUrl: 'ws://fixture.invalid', relay: 'setting', now: clock.now, fetchImpl, logger: noLog, onRelayFailed: () => sync.relayFailed() });
    const wake = new PianoMidiWakeService({ deviceService: devices, deviceId: id, screenOverride: overrides, bridge, clock, logger: noLog });
    const api = new DeviceScreenControlService({ devices, screenOverrides: overrides, midiWake: wake, holdPolicy: {}, nowMs: clock.now, logger: noLog });
    return { api, wake, sync };
  }
  let app = boot();
  await app.api.setOverride(id, 'off', 30);
  await app.wake._relayDone();
  assert.equal(dev.state.value, NOW / 1000 + 1800);
  app = boot();
  app.wake._handleNoteOnForTest();
  assert.equal(wakes, 0);
  assert.equal((await app.sync.reconcile()).wrote, null);
  online = false;
  app.api.clearOverride(id);
  await app.wake._relayDone();
  app = boot();
  online = true;
  assert.equal((await app.sync.reconcile()).wrote, 0);
  app.wake._handleNoteOnForTest();
  assert.equal(wakes, 1);
  await app.api.setOverride(id, 'off', 1);
  await app.wake._relayDone();
  now += 61000;
  app = boot();
  assert.equal(app.api.override(id).override, null);
  assert.ok(dev.state.value * 1000 < now);
  app.wake._handleNoteOnForTest();
  assert.equal(wakes, 2);
});

test('first migration imports an existing bounded tablet hold when no manual decision was recorded', async () => {
  const deadline = NOW + 3600000;
  const dev = device(deadline / 1000);
  const overrides = new ScreenOverrideService({ clock: { now: () => NOW } });
  const sync = new PianoWakeHoldSyncAdapter({ baseUrl: 'http://fixture.invalid', deviceId: 'piano', overrides, now: () => NOW, fetchImpl: dev.fetchImpl, logger: noLog });
  let wakes = 0;
  const wake = new PianoMidiWakeService({
    deviceService: {get: () => ({setScreen: async () => { wakes++; }})}, deviceId: 'piano',
    screenOverride: overrides, bridge: {start(){}, stop(){}, suppressWakeUntil(){}}, logger: noLog,
    prepareWake: () => sync.prepareWake(),
  });
  await wake._handleNoteOnForTest();
  assert.equal(wakes, 0);
  assert.deepEqual(overrides.get('piano'), { state: 'off', until: deadline });
  assert.equal(dev.state.value * 1000, deadline);
});
