import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createPianoMidiWake, _resetForTests } from './midi-wake.mjs';
import { getPianoWakeHoldSync, _resetForTests as resetHoldSync } from './wake-hold-sync.mjs';

afterEach(() => { _resetForTests(); resetHoldSync(); });

const TOKEN = 'w'.repeat(40);
function setup(piano, contentControl) {
  const logs = [];
  const log = (level) => (event, data) => logs.push({ level, event, data });
  let bridgeOpts = null;
  const args = {
    deviceService: { get: () => ({ setScreen: async () => ({ ok: true }) }) },
    configService: {
      getHouseholdAppConfig: () => piano,
      getDeviceConfig: () => ({ content_control: contentControl }),
      getHouseholdAuth: () => ({ 'yellow-room-tablet': { token: TOKEN } }),
    },
    logger: { debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error') },
    getScreenOverrideService: () => ({ get: () => null, set: () => ({}) }),
    bridgeFactory: (o) => { bridgeOpts = o; return { start() {}, stop() {}, suppressWakeUntil: async () => {} }; },
  };
  return { args, logs, opts: () => bridgeOpts };
}
const wake = { enabled: true, device_id: 'yellow-room-tablet', bridge_url: 'ws://old-bridge:8770' };
const android = { provider: 'daylight-android', host: 'tablet.invalid', port: 8780, auth_ref: 'daylight-android' };

test('default: the old bridge URL, unchanged', () => {
  const s = setup({ midi_wake: wake }, { provider: 'fully-kiosk', host: 'tablet.invalid' });
  assert.ok(createPianoMidiWake(s.args).pianoMidiWakeService);
  assert.equal(s.opts().bridgeUrl, 'ws://old-bridge:8770');
  assert.equal(s.opts().headers, undefined);
  assert.equal(s.opts().relay, undefined, 'the old bridge keeps its /config relay (the adapter default)');
});

test('bridge_provider daylight-android: the control port socket with the token header, relaying through the setting', () => {
  const s = setup({ bridge_provider: 'daylight-android', midi_wake: wake }, android);
  assert.ok(createPianoMidiWake(s.args).pianoMidiWakeService);
  assert.equal(typeof s.opts().onRelayFailed, 'function');
  assert.deepEqual({ ...s.opts(), logger: undefined, onRelayFailed: undefined }, {
    bridgeUrl: 'ws://tablet.invalid:8780/', headers: { 'X-Daylight-Token': TOKEN }, relay: 'setting', logger: undefined, onRelayFailed: undefined,
  });
  assert.ok(!JSON.stringify(s.logs).includes(TOKEN));
  assert.equal(s.logs.find((l) => l.event === 'piano-midi-wake.created').data.provider, 'daylight-android');
});

test('bridge_provider daylight-android needs no bridge_url', () => {
  const s = setup({ bridge_provider: 'daylight-android', midi_wake: { enabled: true, device_id: 'yellow-room-tablet' } }, android);
  assert.ok(createPianoMidiWake(s.args).pianoMidiWakeService);
});

test('bridge_provider daylight-android while the tablet still says fully-kiosk: an error, nothing starts', () => {
  const s = setup({ bridge_provider: 'daylight-android', midi_wake: wake }, { provider: 'fully-kiosk', host: 'tablet.invalid' });
  assert.equal(createPianoMidiWake(s.args).pianoMidiWakeService, null);
  assert.ok(s.logs.some((l) => l.event === 'piano-midi-wake.provider-mismatch' && l.level === 'error'));
});

// ── the hold reaches the device's own note wake, on both providers ──
import { PianoMidiWakeService } from '../application/services/PianoMidiWakeService.mjs';
import { PianoMidiBridgeAdapter } from '../adapters/bridge/PianoMidiBridgeAdapter.mjs';

function holdHarness(adapterOptions) {
  const NOW = 1_800_000_000_000;
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url, method: init.method, body: init.body ?? null });
    return { ok: true, status: 200, json: async () => ({ ok: true, values: { targetMac: 'kept' } }) };
  };
  const noLog = { debug() {}, info() {}, warn() {}, error() {} };
  const bridge = new PianoMidiBridgeAdapter({ ...adapterOptions, fetchImpl, logger: noLog, now: () => NOW });
  const overrides = new Map();
  const service = new PianoMidiWakeService({
    deviceService: { get: () => ({ setScreen: async () => ({ ok: true }) }) },
    deviceId: 'yellow-room-tablet', bridge, logger: noLog, clock: { now: () => NOW },
    screenOverride: { get: (id) => overrides.get(id) ?? null, set: (id, state) => overrides.set(id, { state }), clear: (id) => overrides.delete(id) },
  });
  return { NOW, requests, service };
}

test('daylight-android: a manual hold sets power.wakeSuppressUntilSec, and waking on purpose clears it', async () => {
  const h = holdHarness({ bridgeUrl: 'ws://tablet.invalid:8780/', headers: { 'X-Daylight-Token': TOKEN }, relay: 'setting' });
  h.service.suppressWakeUntil(h.NOW + 2 * 3_600_000);
  await h.service._relayDone();
  h.service.resumeWake();
  await h.service._relayDone();
  assert.deepEqual(h.requests.map((r) => [r.method, r.url, JSON.parse(r.body)]), [
    ['POST', 'http://tablet.invalid:8780/settings', { key: 'power.wakeSuppressUntilSec', value: 1_800_007_200 }],
    ['POST', 'http://tablet.invalid:8780/settings', { key: 'power.wakeSuppressUntilSec', value: 0 }],
  ]);
});

test('piano-bridge: the same hold still goes to the old APK by read-merge-write of /config', async () => {
  const h = holdHarness({ bridgeUrl: 'ws://old-bridge.invalid:8770' });
  h.service.suppressWakeUntil(h.NOW + 60_000);
  await h.service._relayDone();
  assert.deepEqual(h.requests.map((r) => [r.method, r.url]), [
    ['GET', 'http://old-bridge.invalid:8770/config'], ['POST', 'http://old-bridge.invalid:8770/config'],
  ]);
  assert.match(h.requests[1].body, /targetMac: kept/);
  assert.match(h.requests[1].body, new RegExp(`fkbWakeSuppressUntilEpochMs: ${h.NOW + 60_000}`));
});

test('a failed relay arms the shared wake-hold sync the supervisor reconciles', () => {
  const s = setup({ bridge_provider: 'daylight-android', midi_wake: wake }, android);
  createPianoMidiWake(s.args);
  const armed = [];
  const endpoint = { provider: 'daylight-android', httpBase: 'http://tablet.invalid:8780', headers: {} };
  // The supervisor gets the same instance; give it a recorder before the relay fails.
  resetHoldSync();
  const sync = getPianoWakeHoldSync({ endpoint, deviceId: 'yellow-room-tablet', getScreenOverrideService: s.args.getScreenOverrideService, factory: () => ({ relayFailed: () => armed.push(1) }) });
  s.opts().onRelayFailed();
  assert.ok(sync);
  assert.deepEqual(armed, [1]);
});
