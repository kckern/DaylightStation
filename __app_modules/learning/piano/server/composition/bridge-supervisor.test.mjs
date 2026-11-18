import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createPianoBridgeSupervisor, _resetForTests } from "./bridge-supervisor.mjs";

afterEach(() => _resetForTests());

const logger = () => {
  const logs = [];
  const f = (level) => (event, data) => logs.push({ level, event, data });
  return { logs, debug: f('debug'), info: f('info'), warn: f('warn'), error: f('error') };
};
const configService = (piano) => ({ getHouseholdAppConfig: () => piano, getHouseholdTimezone: () => 'America/Los_Angeles' });
const scheduler = { every: () => () => {} };

test('disabled config starts nothing', () => {
  const { pianoBridgeSupervisor } = createPianoBridgeSupervisor({
    configService: configService({ bridge_supervisor: { enabled: false } }), remoteAdmin: { performAction() {} },
    logger: logger(), scheduler,
  });
  assert.equal(pianoBridgeSupervisor, null);
});

test('enabled but missing remote admin is an ERROR, not a quiet skip', () => {
  const log = logger();
  const { pianoBridgeSupervisor } = createPianoBridgeSupervisor({
    configService: configService({ bridge_supervisor: { enabled: true, device_id: 'yellow-room-tablet', bridge_url: 'http://t:8770' } }),
    remoteAdmin: null, logger: log, scheduler,
  });
  assert.equal(pianoBridgeSupervisor, null);
  assert.equal(log.logs.find((l) => l.event === 'piano-bridge.supervisor.not-started')?.level, 'error');
});

test('inherits device, url and power entity from sibling blocks; relaunch goes through FKB launch-app', async () => {
  const actions = [];
  const notifies = [];
  const { pianoBridgeSupervisor } = createPianoBridgeSupervisor({
    configService: configService({
      midi_wake: { device_id: 'yellow-room-tablet', bridge_url: 'ws://t:8770' },
      screen_power_sync: { piano_power_entity: 'binary_sensor.piano_power' },
      bridge_supervisor: { enabled: true, notify_service: 'mobile_app_phone', alert_after_ms: 0 },
    }),
    remoteAdmin: { performAction: async (...a) => { actions.push(a); return { ok: true }; } },
    haGateway: {
      getState: async () => ({ state: 'on' }),
      callService: async (...a) => { notifies.push(a); },
    },
    probeFactory: () => ({ readHealth: async () => ({ reachable: false, error: 'down' }) }),
    logger: logger(), scheduler,
  });
  assert.ok(pianoBridgeSupervisor);
  await pianoBridgeSupervisor.tick();
  await pianoBridgeSupervisor.tick();
  assert.deepEqual(actions[0], ['yellow-room-tablet', 'launch-app', { package: 'net.kckern.pianobridge' }]);
  assert.equal(notifies[0][0], 'notify');
  assert.equal(notifies[0][1], 'mobile_app_phone');
});

// ── speaker recovery wiring ──

function deps(pianoConfig, extra = {}) {
  const logs = [];
  const log = (level) => (event, data) => logs.push({ level, event, data });
  return {
    logs,
    args: {
      configService: { getHouseholdAppConfig: () => pianoConfig, getHouseholdTimezone: () => 'America/Los_Angeles' },
      remoteAdmin: { performAction: async () => ({}) },
      haGateway: { getState: async () => ({ state: 'on' }), callService: async () => {} },
      logger: { debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error') },
      probeFactory: () => ({ readHealth: async () => ({ reachable: true, speaker: true }) }),
      scheduler: { every: () => () => {} },
      eventBus: { broadcast: () => {} },
      ...extra,
    },
  };
}
const base = {
  bridge_supervisor: { enabled: true, device_id: 'yellow-room-tablet', bridge_url: 'http://tablet:8770' },
};

test('speaker recovery wires the plug entity and the bus when enabled', () => {
  const d = deps({ ...base, speaker_recovery: { enabled: true, plug_entity: 'switch.yellow_room_piano_plug' } });
  const { pianoBridgeSupervisor } = createPianoBridgeSupervisor(d.args);
  assert.ok(pianoBridgeSupervisor);
  const created = d.logs.find((l) => l.event === 'piano-bridge.supervisor.created');
  assert.equal(created.data.speakerRecovery, true);
  assert.equal(created.data.plugEntity, 'switch.yellow_room_piano_plug');
});

test('speaker recovery off when the block is absent', () => {
  const d = deps(base);
  createPianoBridgeSupervisor(d.args);
  const created = d.logs.find((l) => l.event === 'piano-bridge.supervisor.created');
  assert.equal(created.data.speakerRecovery, false);
});

test('enabled without a plug entity still runs the Bluetooth rungs and says so', () => {
  const d = deps({ ...base, speaker_recovery: { enabled: true } });
  createPianoBridgeSupervisor(d.args);
  const created = d.logs.find((l) => l.event === 'piano-bridge.supervisor.created');
  assert.equal(created.data.speakerRecovery, true);
  assert.equal(created.data.plugEntity, null);
  assert.ok(d.logs.some((l) => l.event === 'piano.speaker.no-plug' && l.level === 'warn'));
});

test('speaker recovery gets a screen hold when the device and override services are present', () => {
  const d = deps({ ...base, speaker_recovery: { enabled: true, plug_entity: 'switch.yellow_room_piano_plug' } }, {
    deviceService: { get: () => ({ getStatus: async () => ({ screenOn: true }) }) },
    getScreenOverrideService: () => ({ get: () => null, set: () => ({}) }),
  });
  createPianoBridgeSupervisor(d.args);
  const created = d.logs.find((l) => l.event === 'piano-bridge.supervisor.created');
  assert.equal(created.data.screenHold, true);
});

test('without them the ladder still runs, and says the screen is unprotected', () => {
  const d = deps({ ...base, speaker_recovery: { enabled: true, plug_entity: 'switch.yellow_room_piano_plug' } });
  createPianoBridgeSupervisor(d.args);
  assert.equal(d.logs.find((l) => l.event === 'piano-bridge.supervisor.created').data.screenHold, false);
  assert.ok(d.logs.some((l) => l.event === 'piano.speaker.no-screen-hold' && l.level === 'warn'));
});

test('speaker recovery gets a readiness check, and a weekly summary when the log store is configured', () => {
  const d = deps({ ...base, speaker_recovery: { enabled: true, plug_entity: 'switch.yellow_room_piano_plug' } });
  d.args.configService.get = (key) => (key === 'logging.remoteSink'
    ? { enabled: true, url: 'http://victoria-logs:9428/insert/jsonline?_time_field=ts' } : undefined);
  createPianoBridgeSupervisor(d.args);
  const created = d.logs.find((l) => l.event === 'piano-bridge.supervisor.created').data;
  assert.equal(created.readiness, true);
  assert.equal(created.weeklySummary, true);
});

test('no log store configured: readiness still runs, weekly summary is off', () => {
  const d = deps({ ...base, speaker_recovery: { enabled: true, plug_entity: 'switch.yellow_room_piano_plug' } });
  createPianoBridgeSupervisor(d.args);
  const created = d.logs.find((l) => l.event === 'piano-bridge.supervisor.created').data;
  assert.equal(created.readiness, true);
  assert.equal(created.weeklySummary, false);
});

test('a disabled remote sink means no weekly summary (nothing ships, so every week would read quiet)', () => {
  const d = deps({ ...base, speaker_recovery: { enabled: true, plug_entity: 'switch.yellow_room_piano_plug' } });
  d.args.configService.get = (key) => (key === 'logging.remoteSink' ? { enabled: false, url: 'http://victoria-logs:9428/insert/jsonline' } : undefined);
  createPianoBridgeSupervisor(d.args);
  assert.equal(d.logs.find((l) => l.event === 'piano-bridge.supervisor.created').data.weeklySummary, false);
});

test('the log module name is exported, so app.mjs and the log-store queries cannot drift apart', async () => {
  const mod = await import('./bridge-supervisor.mjs');
  assert.equal(mod.PIANO_BRIDGE_SUPERVISOR_LOG_MODULE, 'piano-bridge-supervisor');
});

// ── bridge_provider: daylight-android ──

const TOKEN = 'k'.repeat(40);
function androidDeps({ contentControl, auth = { 'yellow-room-tablet': { token: TOKEN } }, piano = {} } = {}) {
  const made = { probe: null, speaker: null, restart: null, restarts: 0 };
  const logs = [];
  const log = (level) => (event, data) => logs.push({ level, event, data });
  const args = {
    configService: {
      getHouseholdAppConfig: () => ({
        bridge_provider: 'daylight-android',
        bridge_supervisor: { enabled: true, device_id: 'yellow-room-tablet', bridge_url: 'ws://old-bridge:8770' },
        speaker_recovery: { enabled: true },
        ...piano,
      }),
      getHouseholdTimezone: () => 'America/Los_Angeles',
      getDeviceConfig: (id) => (id === 'yellow-room-tablet' ? { content_control: contentControl } : null),
      getHouseholdAuth: (ref) => (ref === 'daylight-android' ? auth : null),
    },
    remoteAdmin: { performAction: async () => { throw new Error('the old launch-app path must not be used'); } },
    haGateway: { getState: async () => ({ state: 'on' }), callService: async () => {} },
    logger: { debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error') },
    probeFactory: (o) => { made.probe = o; return { readHealth: async () => ({ reachable: false, error: 'down' }) }; },
    speakerActionsFactory: (o) => { made.speaker = o; return { a2dpReconnect: async () => ({ ok: true }), bluetoothCycle: async () => ({ ok: true }), probeEndpoints: async () => ({ present: true }) }; },
    restartFactory: (o) => { made.restart = o; return { restart: async () => { made.restarts += 1; return { ok: true }; } }; },
    scheduler: { every: () => () => {} },
  };
  return { args, made, logs };
}
const androidControl = { provider: 'daylight-android', host: 'tablet.invalid', port: 8780, auth_ref: 'daylight-android' };

test('daylight-android: probe, speaker actions and relaunch go to the control API and lifeline with the token header', async () => {
  const d = androidDeps({ contentControl: androidControl });
  const { pianoBridgeSupervisor } = createPianoBridgeSupervisor(d.args);
  assert.ok(pianoBridgeSupervisor);
  assert.deepEqual(d.made.probe, { bridgeUrl: 'http://tablet.invalid:8780', headers: { 'X-Daylight-Token': TOKEN } });
  assert.deepEqual(d.made.speaker, { bridgeUrl: 'http://tablet.invalid:8780', headers: { 'X-Daylight-Token': TOKEN } });
  assert.deepEqual(d.made.restart, { lifelineBase: 'http://tablet.invalid:8781', headers: { 'X-Daylight-Token': TOKEN } });
  await pianoBridgeSupervisor.tick();
  await pianoBridgeSupervisor.tick();
  assert.equal(d.made.restarts, 1, 'an unreachable bridge is restarted through the lifeline, not launch-app');
  const created = d.logs.find((l) => l.event === 'piano-bridge.supervisor.created').data;
  assert.equal(created.provider, 'daylight-android');
  assert.equal(created.bridgeUrl, 'http://tablet.invalid:8780');
  assert.ok(!JSON.stringify(d.logs).includes(TOKEN), 'the token is never logged');
});

test('daylight-android: a lifeline_port in content_control is used', () => {
  const d = androidDeps({ contentControl: { ...androidControl, lifeline_port: 9001 } });
  createPianoBridgeSupervisor(d.args);
  assert.equal(d.made.restart.lifelineBase, 'http://tablet.invalid:9001');
});

test('daylight-android while the tablet still says fully-kiosk: an error, and nothing starts', () => {
  const d = androidDeps({ contentControl: { provider: 'fully-kiosk', host: 'tablet.invalid', port: 2323 } });
  const { pianoBridgeSupervisor } = createPianoBridgeSupervisor(d.args);
  assert.equal(pianoBridgeSupervisor, null);
  assert.equal(d.logs.find((l) => l.event === 'piano-bridge.supervisor.provider-mismatch')?.level, 'error');
  assert.equal(d.logs.find((l) => l.event === 'piano-bridge.supervisor.not-started')?.data.provider, 'daylight-android');
});

test('daylight-android with no token for the device: an error, and nothing starts', () => {
  const d = androidDeps({ contentControl: androidControl, auth: { piano: { token: TOKEN } } });
  const { pianoBridgeSupervisor } = createPianoBridgeSupervisor(d.args);
  assert.equal(pianoBridgeSupervisor, null);
  assert.equal(d.logs.find((l) => l.event === 'piano-bridge.supervisor.no-token')?.level, 'error');
});

test('an unknown bridge_provider is an error, not a fallback to the old bridge', () => {
  const d = androidDeps({ contentControl: androidControl, piano: { bridge_provider: 'fully' } });
  assert.equal(createPianoBridgeSupervisor(d.args).pianoBridgeSupervisor, null);
  assert.ok(d.logs.some((l) => l.event === 'piano-bridge.supervisor.unknown-provider' && l.level === 'error'));
});

test('piano-bridge stays the default: the old bridge URL, no headers, launch-app', () => {
  const d = deps(base);
  let probeOpts;
  d.args.probeFactory = (o) => { probeOpts = o; return { readHealth: async () => ({ reachable: true }) }; };
  createPianoBridgeSupervisor(d.args);
  assert.deepEqual(probeOpts, { bridgeUrl: 'http://tablet:8770', headers: {} });
  assert.equal(d.logs.find((l) => l.event === 'piano-bridge.supervisor.created').data.provider, 'piano-bridge');
});

test('daylight-android: each reachable tick lets the wake-hold sync reconcile', async () => {
  const d = androidDeps({ contentControl: androidControl });
  let reconciles = 0;
  d.args.probeFactory = () => ({ readHealth: async () => ({ reachable: true, ble: 'CONNECTED', outVerified: true, speaker: true }) });
  d.args.wakeHoldSync = { reconcile: async () => { reconciles += 1; return { checked: false }; } };
  const { pianoBridgeSupervisor } = createPianoBridgeSupervisor(d.args);
  await pianoBridgeSupervisor.tick();
  await pianoBridgeSupervisor.tick();
  assert.equal(reconciles, 2);
});
