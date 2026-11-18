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
  overrides: { get: () => override }, now: () => NOW, fetchImpl: dev.fetchImpl, logger: noLog,
});

test('after a restart with no hold in the backend, a future deadline left on the tablet is cleared with 0', async () => {
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
