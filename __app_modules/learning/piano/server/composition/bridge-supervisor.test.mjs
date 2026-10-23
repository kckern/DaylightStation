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
