// backend/src/3_applications/devices/services/PianoBridgeSupervisorService.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PianoBridgeSupervisorService } from './PianoBridgeSupervisorService.mjs';
import { composePianoBridgePush } from '../../../2_domains/devices/pianoBridgePush.mjs';

const INTERVAL = 30_000;

function rig({ health = { reachable: true, ble: 'CONNECTED', outVerified: true }, power = 'on', notify = true, relaunchThrows = false } = {}) {
  let t = 1_790_000_000_000;
  const state = { health, power };
  const relaunches = [];
  const pushes = [];
  const logs = [];
  const log = (level) => (event, data) => logs.push({ level, event, data });
  const svc = new PianoBridgeSupervisorService({
    probe: { readHealth: async () => state.health },
    relaunch: async () => {
      relaunches.push(t);
      if (relaunchThrows) throw new Error('FKB unreachable');
      return { ok: true };
    },
    readPianoPower: async () => state.power,
    notify: notify ? async (push) => { pushes.push(push); } : null,
    compose: composePianoBridgePush,
    scheduler: { every: () => () => {} },
    clock: { now: () => t },
    logger: { debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error') },
    deviceId: 'yellow-room-tablet',
    location: 'Yellow Room',
    timezone: 'America/Los_Angeles',
    intervalMs: INTERVAL,
    alertAfterMs: 5 * 60_000,
    oneWayAlertAfterMs: 10 * 60_000,
  });
  const step = async (n = 1) => { for (let i = 0; i < n; i++) { await svc.tick(); t += INTERVAL; } };
  const events = (name) => logs.filter((l) => l.event === name);
  return { svc, state, relaunches, pushes, logs, step, events, advance: (ms) => { t += ms; } };
}

const DOWN = { reachable: false, ble: null, outVerified: null, error: 'ECONNREFUSED' };

test('one failed check is a blip: no relaunch, no down event', async () => {
  const r = rig({ health: DOWN });
  await r.step(1);
  assert.equal(r.relaunches.length, 0);
  assert.equal(r.events('piano-bridge.supervisor.down').length, 0);
  r.state.health = { reachable: true, ble: 'CONNECTED', outVerified: true };
  await r.step(1);
  assert.equal(r.events('piano-bridge.supervisor.recovered').length, 0);
});

test('confirmed down relaunches immediately, logs an error, and backs off', async () => {
  const r = rig({ health: DOWN });
  await r.step(2);
  assert.equal(r.events('piano-bridge.supervisor.down').length, 1);
  assert.equal(r.events('piano-bridge.supervisor.down')[0].level, 'error');
  assert.equal(r.relaunches.length, 1);
  await r.step(1); // 30 s later: inside the 60 s backoff
  assert.equal(r.relaunches.length, 1);
  await r.step(1); // 60 s after the first relaunch
  assert.equal(r.relaunches.length, 2);
});

test('still down after alertAfterMs pushes exactly once, even as checks continue', async () => {
  const r = rig({ health: DOWN });
  await r.step(12); // 6 minutes of failed checks
  assert.equal(r.pushes.length, 1);
  assert.match(r.pushes[0].title, /Piano sound is down \(Yellow Room\)/);
  assert.equal(r.pushes[0].data.tag, 'piano-bridge-yellow-room-tablet');
  await r.step(40);
  assert.equal(r.pushes.length, 1);
});

test('a relaunch that brings it back before alertAfterMs never pages anyone', async () => {
  const r = rig({ health: DOWN });
  await r.step(3);
  r.state.health = { reachable: true, ble: 'CONNECTED', outVerified: true };
  await r.step(1);
  assert.equal(r.pushes.length, 0);
  const rec = r.events('piano-bridge.supervisor.recovered');
  assert.equal(rec.length, 1);
  assert.equal(rec[0].data.relaunches, 1);
});

test('recovery after an alert sends a quiet replacement card on the same tag', async () => {
  const r = rig({ health: DOWN });
  await r.step(12);
  r.state.health = { reachable: true, ble: 'CONNECTED', outVerified: true };
  await r.step(1);
  assert.equal(r.pushes.length, 2);
  assert.match(r.pushes[1].title, /Piano sound is back/);
  assert.equal(r.pushes[1].data.tag, r.pushes[0].data.tag);
  assert.equal(r.pushes[1].data.alert_once, true);
});

test('a relaunch that throws is logged and retried; the alert still goes out', async () => {
  const r = rig({ health: DOWN, relaunchThrows: true });
  await r.step(12);
  const attempts = r.events('piano-bridge.supervisor.relaunch');
  assert.ok(attempts.length >= 3);
  assert.equal(attempts[0].data.ok, false);
  assert.equal(r.pushes.length, 1);
});

test('no notify service: the would-be alert is an error log, never swallowed', async () => {
  const r = rig({ health: DOWN, notify: false });
  await r.step(12);
  const unsent = r.events('piano-bridge.supervisor.alert-unsent');
  assert.ok(unsent.length >= 1);
  assert.equal(unsent[0].level, 'error');
});

test('one-way: unverified echo with the piano ON pages after the window', async () => {
  const r = rig({ health: { reachable: true, ble: 'CONNECTED', outVerified: false } });
  await r.step(20); // 10 minutes
  assert.equal(r.pushes.length, 0);
  await r.step(2);
  assert.equal(r.pushes.length, 1);
  assert.match(r.pushes[0].title, /not receiving sound/);
  r.state.health = { reachable: true, ble: 'CONNECTED', outVerified: true };
  await r.step(1);
  assert.equal(r.pushes.length, 2);
  assert.match(r.pushes[1].title, /back/);
});

test('one-way: a piano that is OFF never echoes, and that is not an alarm', async () => {
  const r = rig({ health: { reachable: true, ble: 'CONNECTED', outVerified: false }, power: 'off' });
  await r.step(60);
  assert.equal(r.pushes.length, 0);
  assert.equal(r.events('piano-bridge.supervisor.one-way').length, 0);
});

test('one-way: unknown power (HA unreachable) does not page', async () => {
  const r = rig({ health: { reachable: true, ble: 'CONNECTED', outVerified: false }, power: 'unknown' });
  await r.step(60);
  assert.equal(r.pushes.length, 0);
});

test('overlapping ticks are serialized', async () => {
  let release;
  let calls = 0;
  const svc = new PianoBridgeSupervisorService({
    probe: { readHealth: () => { calls += 1; return new Promise((res) => { release = res; }); } },
    relaunch: async () => ({ ok: true }),
    compose: composePianoBridgePush,
    scheduler: { every: () => () => {} },
    deviceId: 'yellow-room-tablet',
    logger: {},
  });
  const first = svc.tick();
  await svc.tick();
  assert.equal(calls, 1);
  release({ reachable: true, ble: 'CONNECTED', outVerified: true });
  await first;
});
