import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createPianoBridgeSupervisor, _resetForTests } from './pianoBridgeSupervisor.mjs';

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
