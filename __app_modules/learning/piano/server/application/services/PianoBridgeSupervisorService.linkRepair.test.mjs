import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PianoBridgeSupervisorService } from './PianoBridgeSupervisorService.mjs';
import { composePianoBridgePush } from '../../domain/bridge/pianoBridgePush.mjs';

const INTERVAL = 30_000;
const HOLD = 3 * 60_000;
const HOLD_TICKS = HOLD / INTERVAL + 1;
const NO_ECHO = { reachable: true, ble: 'CONNECTED', outVerified: false };
const ECHO = { reachable: true, ble: 'CONNECTED', outVerified: true };
const DOWN = { reachable: false, ble: null, outVerified: null, error: 'ECONNREFUSED' };

function rig({ health = NO_ECHO, power = 'on', clients = 0, idle = { idle: true }, rebootRows = [], powerOnSettleMs = 0, speaker = null } = {}) {
  let t = 1_790_000_000_000;
  const state = { health, power, clients, idle, rebootRows, rebootResult: { ok: true } };
  const reboots = [];
  const relaunches = [];
  const pushes = [];
  const logs = [];
  const queries = [];
  const log = (level) => (event, data) => logs.push({ level, event, data });
  const svc = new PianoBridgeSupervisorService({
    probe: { readHealth: async () => state.health },
    relaunch: async () => { relaunches.push(t); return { ok: true }; },
    readPianoPower: async () => state.power,
    notify: async (push) => { pushes.push(push); },
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
    linkRepair: {
      readJamcorderClients: async () => {
        if (state.clients instanceof Error) throw state.clients;
        return state.clients;
      },
      checkKioskIdle: async () => {
        if (state.idle instanceof Error) throw state.idle;
        return state.idle;
      },
      reboot: async () => { reboots.push(t); return state.rebootResult; },
      queryLogs: async (q) => {
        queries.push(q);
        if (state.rebootRows instanceof Error) throw state.rebootRows;
        return state.rebootRows;
      },
      holdMs: HOLD,
      minRebootGapMs: 60 * 60_000,
      maxRebootsPerDay: 3,
      rebootGraceMs: 5 * 60_000,
      powerOnSettleMs,
      retryAfterFailureMs: 5 * 60_000,
    },
    speaker,
  });
  const step = async (n = 1) => { for (let i = 0; i < n; i++) { await svc.tick(); t += INTERVAL; } };
  const events = (name) => logs.filter((l) => l.event === name);
  return { state, reboots, relaunches, pushes, queries, step, events, now: () => t, advance: (ms) => { t += ms; } };
}

test('reboots the tablet once the link has been missing for the hold time', async () => {
  const r = rig();
  await r.step(HOLD_TICKS);
  assert.equal(r.reboots.length, 1);
  assert.equal(r.events('piano-bridge.supervisor.link-reboot').length, 1);
  assert.equal(r.pushes.length, 0, 'a repair nobody needs to act on stays silent');
});

test('does not reboot before the hold time has passed', async () => {
  const r = rig();
  await r.step(HOLD_TICKS - 1);
  assert.equal(r.reboots.length, 0);
  assert.equal(r.events('piano-bridge.supervisor.link-missing').length, 1);
});

for (const [name, opts] of [
  ['the piano is off', { power: 'off' }],
  ['piano power is unknown', { power: 'unknown' }],
  ['the JamCorder has a client', { clients: 1 }],
  ['the JamCorder cannot be read', { clients: null }],
  ['the JamCorder read throws', { clients: new Error('EHOSTUNREACH') }],
  ['the piano is echoing', { health: ECHO }],
]) {
  test(`never reboots when ${name}`, async () => {
    const r = rig(opts);
    await r.step(HOLD_TICKS + 4);
    assert.equal(r.reboots.length, 0);
  });
}

test('a moment of contrary evidence restarts the hold', async () => {
  const r = rig();
  await r.step(HOLD_TICKS - 1);
  r.state.clients = 1;
  await r.step(1);
  r.state.clients = 0;
  await r.step(HOLD_TICKS - 1);
  assert.equal(r.reboots.length, 0);
  await r.step(1);
  assert.equal(r.reboots.length, 1);
});

test('while someone is using the kiosk it waits, tells a person once, then repairs when free', async () => {
  const r = rig({ idle: { idle: false, reason: 'activity' } });
  await r.step(HOLD_TICKS + 6);
  assert.equal(r.reboots.length, 0);
  assert.equal(r.pushes.length, 1);
  assert.match(r.pushes[0].title, /lost its connection \(Yellow Room\)/);
  assert.match(r.pushes[0].message, /nobody is using/);
  r.state.idle = { idle: true };
  await r.step(1);
  assert.equal(r.reboots.length, 1);
});

test('an idle check that lost sight of the kiosk blocks as unknown', async () => {
  const r = rig({ idle: { idle: false, reason: 'no-telemetry' } });
  await r.step(HOLD_TICKS);
  assert.equal(r.reboots.length, 0);
  assert.match(r.pushes[0].message, /could not tell/);
});

test('an idle check that fails blocks the reboot', async () => {
  const r = rig({ idle: new Error('log store down') });
  await r.step(HOLD_TICKS + 2);
  assert.equal(r.reboots.length, 0);
  assert.equal(r.pushes.length, 1);
  assert.match(r.pushes[0].message, /could not tell/);
});

test('a reboot inside the minimum gap waits quietly', async () => {
  const r = rig();
  r.state.rebootRows = [{ _time: new Date(r.now() - 10 * 60_000).toISOString() }];
  await r.step(HOLD_TICKS + 2);
  assert.equal(r.reboots.length, 0);
  assert.equal(r.pushes.length, 0, 'one recent reboot is not yet a reason to call a person');
  assert.equal(r.events('piano-bridge.supervisor.link-reboot-blocked').length, 1);
  assert.equal(r.events('piano-bridge.supervisor.link-reboot-blocked')[0].data.reason, 'gap');
});

test('the daily cap holds even when the last reboot is old enough', async () => {
  const r = rig();
  const ago = (h) => ({ _time: new Date(r.now() - h * 3_600_000).toISOString() });
  r.state.rebootRows = [ago(3), ago(5), ago(7)];
  await r.step(HOLD_TICKS + 2);
  assert.equal(r.reboots.length, 0);
  assert.equal(r.pushes.length, 1);
  assert.match(r.pushes[0].message, /Restart the tablet by hand/);
});

test('at the cap a busy kiosk gets the truth, not a promise of a restart', async () => {
  const r = rig({ idle: { idle: false, reason: 'activity' } });
  const ago = (h) => ({ _time: new Date(r.now() - h * 3_600_000).toISOString() });
  r.state.rebootRows = [ago(3), ago(5), ago(7)];
  await r.step(HOLD_TICKS);
  assert.match(r.pushes[0].message, /Restart the tablet by hand/);
});

test('an unparseable reboot time blocks instead of undercounting', async () => {
  const r = rig({ rebootRows: [{ _time: 'not-a-time' }] });
  await r.step(HOLD_TICKS + 1);
  assert.equal(r.reboots.length, 0);
  assert.equal(r.events('piano-bridge.supervisor.link-reboot-blocked')[0].data.reason, 'unknown');
});

test('reboots that do not bring the echo back stop at the cap until an echo returns', async () => {
  const r = rig();
  for (let i = 0; i < 5; i++) {
    await r.step(HOLD_TICKS + 12);
    r.advance(2 * 3_600_000);
  }
  assert.equal(r.reboots.length, 3);
  r.state.health = ECHO;
  await r.step(1);
  r.state.health = NO_ECHO;
  r.advance(25 * 3_600_000);
  await r.step(HOLD_TICKS);
  assert.equal(r.reboots.length, 4);
});

test('own reboots count toward the daily cap even if the log store never shows them', async () => {
  const r = rig();
  r.state.health = NO_ECHO;
  for (let i = 0; i < 3; i++) {
    await r.step(HOLD_TICKS + 11);
    r.state.health = ECHO;
    await r.step(1);
    r.state.health = NO_ECHO;
    r.advance(2 * 3_600_000);
  }
  await r.step(HOLD_TICKS + 1);
  assert.equal(r.reboots.length, 3);
});

test('a just-powered piano gets a settling period before any reboot', async () => {
  const r = rig({ power: 'off', powerOnSettleMs: 5 * 60_000 });
  await r.step(2);
  r.state.power = 'on';
  await r.step(HOLD_TICKS + 2);
  assert.equal(r.reboots.length, 0);
  await r.step(4);
  assert.equal(r.reboots.length, 1);
});

for (const ble of ['IDLE', 'NO_BLUETOOTH', 'NO_LOCATION', null]) {
  test(`bridge state ${ble} never counts toward a reboot`, async () => {
    const r = rig({ health: { ...NO_ECHO, ble } });
    await r.step(HOLD_TICKS + 2);
    assert.equal(r.reboots.length, 0);
    assert.equal(r.events('piano-bridge.supervisor.link-missing').length, 0);
  });
}

for (const ble of ['CONNECTING', 'SCANNING', 'FAILED']) {
  test(`bridge state ${ble} still counts: the corrected bridge will not claim CONNECTED`, async () => {
    const r = rig({ health: { ...NO_ECHO, ble } });
    await r.step(HOLD_TICKS);
    assert.equal(r.reboots.length, 1);
  });
}

test('a speaker repair in progress holds the reboot, because it can cut JamCorder power', async () => {
  const actions = { a2dpReconnect: async () => ({ ok: true }), bluetoothCycle: async () => ({ ok: true }) };
  const r = rig({ health: { ...NO_ECHO, speaker: false }, speaker: { actions, compose: () => null, policy: { confirmMs: 0 } } });
  await r.step(HOLD_TICKS + 2);
  assert.equal(r.reboots.length, 0);
});

test('reboot history is scoped to this device and an unreadable history blocks', async () => {
  const r = rig({ rebootRows: new Error('log store down') });
  await r.step(HOLD_TICKS + 1);
  assert.equal(r.reboots.length, 0);
  assert.match(r.queries[0], /"piano-bridge\.supervisor\.link-reboot"/);
  assert.match(r.queries[0], /_time:24h/);
  assert.match(r.queries[0], /data\.deviceId:"yellow-room-tablet"/);
});

test('a second reboot in the same process respects the gap before the log store catches up', async () => {
  const r = rig();
  await r.step(HOLD_TICKS);
  r.state.health = DOWN;
  await r.step(1);
  r.state.health = NO_ECHO;
  await r.step(HOLD_TICKS + 2);
  assert.equal(r.reboots.length, 1);
  assert.equal(r.events('piano-bridge.supervisor.link-reboot-blocked').at(-1).data.reason, 'gap');
  assert.equal(r.pushes.length, 0);
});

test('a reboot seen both in memory and in the log store counts once', async () => {
  const r = rig();
  const rebootAt = r.now() + (HOLD_TICKS - 1) * INTERVAL;
  r.state.rebootRows = [];
  await r.step(HOLD_TICKS);
  assert.equal(r.reboots[0], rebootAt);
  r.state.rebootRows = [
    { _time: new Date(rebootAt - 3 * 3_600_000).toISOString() },
    { _time: new Date(rebootAt + 2_000).toISOString() },
  ];
  r.advance(61 * 60_000);
  await r.step(HOLD_TICKS);
  assert.equal(r.reboots.length, 2);
});

test('a refused reboot is logged and a person is told', async () => {
  const r = rig();
  r.state.rebootResult = { ok: false, error: 'FKB refused' };
  await r.step(HOLD_TICKS);
  assert.equal(r.reboots.length, 1);
  assert.equal(r.pushes.length, 1);
  assert.match(r.pushes[0].message, /did not accept/);
  assert.equal(r.events('piano-bridge.supervisor.link-reboot').length, 0, 'a failed attempt is not reboot history');
  assert.equal(r.events('piano-bridge.supervisor.link-reboot-failed').length, 1);
  r.state.rebootResult = { ok: true };
  await r.step(11);
  assert.equal(r.reboots.length, 2, 'it retries after the failure wait, not the full gap');
});

test('a reboot the tablet never acted on is reported, not assumed', async () => {
  const r = rig();
  await r.step(HOLD_TICKS + 11);
  assert.equal(r.events('piano-bridge.supervisor.link-reboot-unconfirmed').length, 1);
  assert.equal(r.pushes.length, 1);
  assert.match(r.pushes[0].message, /did not accept/);
});

test('the bridge going away during the reboot is not treated as a crash', async () => {
  const r = rig();
  await r.step(HOLD_TICKS);
  r.state.health = DOWN;
  await r.step(6);
  assert.equal(r.relaunches.length, 0);
  assert.equal(r.events('piano-bridge.supervisor.down').length, 0);
  assert.equal(r.pushes.length, 0);
});

test('a bridge still gone after the grace period is handled as down', async () => {
  const r = rig();
  await r.step(HOLD_TICKS);
  r.state.health = DOWN;
  await r.step(12);
  assert.equal(r.events('piano-bridge.supervisor.down').length, 1);
  assert.ok(r.relaunches.length >= 1);
});

test('an echo after the reboot records the repair without ringing anyone', async () => {
  const r = rig();
  await r.step(HOLD_TICKS);
  r.state.health = ECHO;
  r.state.clients = 1;
  await r.step(1);
  assert.equal(r.events('piano-bridge.supervisor.link-repaired').length, 1);
  assert.equal(r.pushes.length, 0);
});

test('a person who was told hears when it is working again', async () => {
  const r = rig({ idle: { idle: false, reason: 'activity' } });
  await r.step(HOLD_TICKS);
  r.state.health = ECHO;
  r.state.clients = 1;
  await r.step(1);
  assert.equal(r.pushes.length, 2);
  assert.match(r.pushes[1].title, /Piano sound is back/);
});

test('the one-way card is not sent while the real problem is a missing link', async () => {
  const r = rig({ idle: { idle: false, reason: 'activity' } });
  await r.step(24);
  assert.equal(r.pushes.length, 1);
  assert.doesNotMatch(r.pushes[0].message, /Keys still reach the screen/);
});

test('switching the piano off ends the episode so the next one can alert again', async () => {
  const r = rig({ idle: { idle: false, reason: 'activity' } });
  await r.step(HOLD_TICKS);
  assert.equal(r.pushes.length, 1);
  r.state.power = 'off';
  await r.step(1);
  r.state.power = 'on';
  await r.step(HOLD_TICKS);
  assert.equal(r.pushes.length, 2);
});

test('the speaker ladder stays out of the way while the tablet reboots', async () => {
  let attempts = 0;
  const actions = { a2dpReconnect: async () => { attempts += 1; return { ok: true }; }, bluetoothCycle: async () => { attempts += 1; return { ok: true }; } };
  const r = rig({ speaker: { actions, compose: () => null } });
  await r.step(HOLD_TICKS);
  r.state.health = { ...NO_ECHO, speaker: false };
  await r.step(8);
  assert.equal(attempts, 0);
});

test('recovery of a link alert and a one-way alert sends one card', async () => {
  const r = rig({ clients: 1 });
  await r.step(22);
  assert.equal(r.pushes.length, 1, 'one-way alert');
  r.state.clients = 0;
  r.state.idle = { idle: false, reason: 'activity' };
  await r.step(HOLD_TICKS);
  assert.equal(r.pushes.length, 2, 'link alert');
  r.state.health = ECHO;
  await r.step(1);
  assert.equal(r.pushes.length, 3);
});
