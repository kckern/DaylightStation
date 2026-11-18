import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createPianoMidiWake, _resetForTests } from './midi-wake.mjs';

afterEach(() => _resetForTests());

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
});

test('bridge_provider daylight-android: the control port socket with the token header and no relay', () => {
  const s = setup({ bridge_provider: 'daylight-android', midi_wake: wake }, android);
  assert.ok(createPianoMidiWake(s.args).pianoMidiWakeService);
  assert.deepEqual({ ...s.opts(), logger: undefined }, {
    bridgeUrl: 'ws://tablet.invalid:8780/', headers: { 'X-Daylight-Token': TOKEN }, suppressRelay: false, logger: undefined,
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
