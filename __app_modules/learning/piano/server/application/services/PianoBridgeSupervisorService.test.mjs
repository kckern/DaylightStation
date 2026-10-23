// __backend/src/3_applications/devices/services/PianoBridgeSupervisorService.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PianoBridgeSupervisorService } from "./PianoBridgeSupervisorService.mjs";
import { composePianoBridgePush } from "../../domain/bridge/pianoBridgePush.mjs";
import { composePianoSpeakerPush } from "../../domain/bridge/pianoSpeakerPush.mjs";

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


function speakerRig({ power = 'on', plug = true, plugResult = { ok: true, error: null, unpowered: false }, failA2dp = false, notifyResult = undefined, hold = true, checkReady = null, queryLogs = null, start = 1_790_000_000_000, notify = true } = {}) {
  let t = start;
  const state = { health: { reachable: true, ble: 'CONNECTED', outVerified: true, speaker: true }, power, notifyResult };
  const calls = [];
  const pushes = [];
  const published = [];
  const logs = [];
  const log = (level) => (event, data) => logs.push({ level, event, data });
  const svc = new PianoBridgeSupervisorService({
    probe: { readHealth: async () => state.health },
    relaunch: async () => ({ ok: true }),
    readPianoPower: async () => state.power,
    notify: notify ? async (p) => { pushes.push(p); return state.notifyResult; } : null,
    compose: composePianoBridgePush,
    scheduler: { every: () => () => {} },
    clock: { now: () => t },
    logger: { debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error') },
    deviceId: 'yellow-room-tablet',
    location: 'Yellow Room',
    timezone: 'America/Los_Angeles',
    intervalMs: 30_000,
    speaker: {
      holdScreen: hold ? async (ms) => { calls.push(`holdScreen:${ms}`); } : null,
      checkReady,
      queryLogs,
      actions: {
        a2dpReconnect: async () => { calls.push('a2dpReconnect'); return failA2dp ? { ok: false, error: 'endpoint-missing' } : { ok: true, error: null }; },
        bluetoothCycle: async (ms) => { calls.push(`btCycle:${ms}`); return { ok: true, error: null }; },
      },
      plugCycle: plug ? async (ms) => { calls.push(`plugCycle:${ms}`); return plugResult; } : null,
      publish: (payload) => published.push(payload),
      compose: composePianoSpeakerPush,
    },
  });
  const step = async (n = 1) => { for (let i = 0; i < n; i++) { await svc.tick(); t += 30_000; } };
  const events = (name) => logs.filter((l) => l.event === name);
  const down = () => { state.health = { ...state.health, speaker: false }; };
  const up = () => { state.health = { ...state.health, speaker: true }; };
  return { svc, state, calls, pushes, published, step, events, down, up };
}

test('speaker: runs the five rungs in order with the spec parameters, then pushes once', async () => {
  const r = speakerRig();
  r.down();
  await r.step(30);
  assert.deepEqual(r.calls, ['a2dpReconnect', 'btCycle:5000', 'btCycle:15000', 'holdScreen:70000', 'plugCycle:10000', 'holdScreen:120000', 'plugCycle:30000']);
  assert.equal(r.pushes.length, 1);
  assert.match(r.pushes[0].title, /Piano speaker won't reconnect \(Yellow Room\)/);
  assert.equal(r.events('piano.speaker.gave-up').length, 1);
  assert.equal(r.events('piano.speaker.gave-up')[0].level, 'error');
  assert.equal(r.events('piano.speaker.dropped').length, 1);
});

test('speaker: silent recovery — no push, recovered logged with the rung', async () => {
  const r = speakerRig();
  r.down();
  await r.step(3); // rung 2 fired
  r.up();
  await r.step(1);
  assert.equal(r.pushes.length, 0);
  const rec = r.events('piano.speaker.recovered');
  assert.equal(rec.length, 1);
  assert.equal(rec[0].data.rung, 2);
});

test('speaker: publishes recovering then ok, never needs-help, on a silent fix', async () => {
  const r = speakerRig();
  r.down();
  await r.step(3);
  r.up();
  await r.step(1);
  // First tick announces the current state (clears a banner left over from before a restart).
  assert.deepEqual(r.published.map((p) => p.state), ['ok', 'recovering', 'ok']);
  assert.equal(r.published[1].topic, 'piano.speaker');
  assert.equal(r.published[1].deviceId, 'yellow-room-tablet');
});

test('speaker: needs-help is re-published every tick so a reloaded kiosk catches up', async () => {
  const r = speakerRig();
  r.down();
  await r.step(30);
  const n = r.published.filter((p) => p.state === 'needs-help').length;
  await r.step(2);
  assert.equal(r.published.filter((p) => p.state === 'needs-help').length, n + 2);
});

test('speaker: recovery after a push sends the quiet back card', async () => {
  const r = speakerRig();
  r.down();
  await r.step(30);
  r.up();
  await r.step(1);
  assert.equal(r.pushes.length, 2);
  assert.match(r.pushes[1].title, /Piano speaker is back/);
  assert.equal(r.pushes[1].data.alert_once, true);
});

test('speaker: a plug cycle that cannot restore power pages at once', async () => {
  const r = speakerRig({ plugResult: { ok: false, error: 'turn_on: HA timeout', unpowered: true } });
  r.down();
  await r.step(10); // reaches rung 4
  assert.ok(r.calls.includes('plugCycle:10000'));
  assert.equal(r.pushes.length, 1);
  assert.match(r.pushes[0].title, /Piano is unpowered/);
  await r.step(10);
  assert.ok(!r.calls.includes('plugCycle:30000'), 'never cycles again once unpowered');
});

test('speaker: a failing rung is logged at warn and the ladder continues', async () => {
  const r = speakerRig({ failA2dp: true });
  r.down();
  await r.step(3);
  const failed = r.events('piano.speaker.attempt-failed');
  assert.equal(failed.length, 1);
  assert.equal(failed[0].level, 'warn');
  assert.equal(failed[0].data.error, 'endpoint-missing');
  assert.deepEqual(r.calls, ['a2dpReconnect', 'btCycle:5000']);
});

test('speaker: piano off never opens an episode', async () => {
  const r = speakerRig({ power: 'off' });
  r.down();
  await r.step(10);
  assert.deepEqual(r.calls, []);
  assert.deepEqual(r.published.map((p) => p.state), ['ok']); // announced once at start, never again
});

test('speaker: bridge unreachable pauses the ladder', async () => {
  const r = speakerRig();
  r.down();
  await r.step(2); // rung 1
  r.state.health = { reachable: false, ble: null, outVerified: null, speaker: null, error: 'ECONNREFUSED' };
  await r.step(10);
  assert.deepEqual(r.calls, ['a2dpReconnect']);
});

test('speaker: feature off (speaker: null) changes nothing', async () => {
  const r = rig();
  r.state.health = { ...r.state.health, speaker: false };
  await r.step(10);
  assert.equal(r.events('piano.speaker.dropped').length, 0);
});

test('speaker: holds the screen for the whole plug window, just before cutting power', async () => {
  const r = speakerRig();
  r.down();
  await r.step(30);
  const i = r.calls.indexOf('plugCycle:10000');
  assert.equal(r.calls[i - 1], 'holdScreen:70000'); // offMs 10 s + check 60 s
  const j = r.calls.indexOf('plugCycle:30000');
  assert.equal(r.calls[j - 1], 'holdScreen:120000'); // offMs 30 s + check 90 s
});

test('speaker: a notify that HA rejects is not "told" — retried, and the bus says so', async () => {
  const r = speakerRig({ notifyResult: { ok: false, error: 'HA 401' } });
  r.down();
  await r.step(30);
  assert.ok(r.events('piano-bridge.supervisor.alert-failed').length >= 1);
  assert.equal(r.events('piano-bridge.supervisor.alert-sent').length, 0);
  const last = r.published.at(-1);
  assert.equal(last.state, 'needs-help');
  assert.equal(last.told, false);
  const attempts = r.pushes.length;
  r.state.notifyResult = { ok: true };
  await r.step(1);
  assert.equal(r.pushes.length, attempts + 1);
  assert.equal(r.published.at(-1).told, true);
  await r.step(3);
  assert.equal(r.pushes.length, attempts + 1); // told once, never again
});

test('speaker: recovery after a give-up nobody heard about sends no back card', async () => {
  const r = speakerRig({ notifyResult: { ok: false, error: 'HA 401' } });
  r.down();
  await r.step(30);
  const before = r.pushes.length;
  r.state.notifyResult = { ok: false, error: 'still down' };
  r.up();
  await r.step(1);
  assert.ok(r.pushes.slice(before).every((p) => !/is back/.test(p.title)));
  assert.equal(r.published.at(-1).state, 'ok');
});

test('speaker: the give-up push says the piano was not restarted when no plug is wired', async () => {
  const r = speakerRig({ plug: false });
  r.down();
  await r.step(30);
  assert.equal(r.pushes.length, 1);
  assert.match(r.pushes[0].message, /not restarted/);
  assert.doesNotMatch(r.pushes[0].message, /including restarting the piano/);
});

test('speaker: first tick announces ok so a stale needs-help banner clears after a restart', async () => {
  const r = speakerRig();
  await r.step(1);
  assert.deepEqual(r.published.map((p) => [p.state, p.told]), [['ok', false]]);
});

// ── readiness + weekly summary ─────────────────────────────────────────────

test('readiness: a broken link pushes once a day at most, re-checks hourly, and clears with a quiet card', async () => {
  const state = { problems: ['plug-unavailable'] };
  let checks = 0;
  const r = speakerRig({ checkReady: async () => { checks++; return state.problems; } });
  await r.step(1);
  assert.equal(checks, 1);
  assert.equal(r.pushes.length, 0);  // one sighting is a suspicion, not an alarm
  await r.step(21);                  // ~10 min later: confirmed
  assert.equal(checks, 2);
  assert.equal(r.pushes.length, 1);
  assert.match(r.pushes[0].title, /self-repair is broken/);
  assert.equal(r.events('piano.speaker.not-ready')[0].level, 'warn');
  await r.step(10);                  // 5 min: no re-check yet
  assert.equal(checks, 2);
  await r.step(120);                 // past an hour: re-checked, still broken, no second push today
  assert.ok(checks >= 3);
  assert.equal(r.pushes.length, 1);
  state.problems = [];
  await r.step(121);                // next hourly check sees it fixed
  assert.equal(r.pushes.length, 2);
  assert.match(r.pushes[1].title, /working again/);
});

test('readiness: healthy is logged, never pushed, and re-checked daily', async () => {
  let checks = 0;
  const r = speakerRig({ checkReady: async () => { checks++; return []; } });
  await r.step(1);
  assert.equal(r.events('piano.speaker.ready').length, 1);
  assert.equal(r.pushes.length, 0);
  await r.step(2 * 60 * 23);       // 23 h
  assert.equal(checks, 1);
  await r.step(2 * 60 * 2);        // past 24 h
  assert.equal(checks, 2);
});

test('readiness: a check that throws is a warning, retried, never a crash', async () => {
  const r = speakerRig({ checkReady: async () => { throw new Error('HA down'); } });
  await r.step(1);
  assert.equal(r.events('piano.speaker.ready-check-failed')[0].level, 'warn');
  assert.equal(r.pushes.length, 0);
});

// Sunday 2026-10-25 19:00 America/Los_Angeles = 2026-10-26T02:00:00Z
const SUNDAY_EVENING = Date.parse('2026-10-26T02:00:00Z');
const row = (msg, rung) => ({ _msg: msg, 'data.rung': rung == null ? undefined : String(rung) });

test('weekly: Sunday evening sums the week from the log store and pushes once', async () => {
  const queries = [];
  const r = speakerRig({
    start: SUNDAY_EVENING,
    queryLogs: async (q) => {
      queries.push(q);
      if (q.includes('weekly-summary')) return [];
      return [row('piano.speaker.dropped'), row('piano.speaker.dropped'), row('piano.speaker.dropped'),
        row('piano.speaker.recovered', 4), row('piano.speaker.recovered', 4), row('piano.speaker.recovered', 2)];
    },
  });
  await r.step(1);
  const weekly = r.pushes.filter((p) => /this week/.test(p.title));
  assert.equal(weekly.length, 1);
  assert.equal(weekly[0].message, 'Dropped 3 times and fixed itself every time: 2 by restarting the piano, 1 by a Bluetooth reset.');
  assert.deepEqual(r.events('piano.speaker.weekly-summary')[0].data.byRung, { 4: 2, 2: 1 });
  assert.ok(queries.every((q) => q.includes('context.module:"piano-bridge-supervisor"')));
  await r.step(5);
  assert.equal(r.pushes.filter((p) => /this week/.test(p.title)).length, 1);
});

test('weekly: a summary already in the store (redeploy on Sunday) is not repeated', async () => {
  const r = speakerRig({ start: SUNDAY_EVENING, queryLogs: async (q) => (q.includes('weekly-summary') ? [row('piano.speaker.weekly-summary')] : [row('piano.speaker.dropped')]) });
  await r.step(3);
  assert.equal(r.pushes.filter((p) => /this week/.test(p.title)).length, 0);
});

test('weekly: a quiet week is logged but not pushed', async () => {
  const r = speakerRig({ start: SUNDAY_EVENING, queryLogs: async () => [] });
  await r.step(1);
  assert.equal(r.events('piano.speaker.weekly-summary').length, 1);
  assert.equal(r.pushes.length, 0);
});

test('weekly: never runs outside Sunday evening', async () => {
  let asked = 0;
  const r = speakerRig({ start: Date.parse('2026-10-24T02:00:00Z'), queryLogs: async () => { asked++; return []; } }); // Fri 19:00 PT
  await r.step(4);
  assert.equal(asked, 0);
});

test('readiness: a single blip (HA restarting) never pushes, and never sends a working-again card', async () => {
  let checks = 0;
  const r = speakerRig({ checkReady: async () => { checks++; return checks === 1 ? ['plug-unavailable'] : []; } });
  await r.step(30);
  assert.equal(r.pushes.length, 0);
  assert.equal(r.events('piano.speaker.not-ready-suspected').length, 1);
});

test('readiness: a restart inside 24 h of a sent alert does not alert again (budget lives in the log store)', async () => {
  const queries = [];
  const r = speakerRig({
    checkReady: async () => ['plug-unavailable'],
    queryLogs: async (q) => { queries.push(q); return q.includes('alert-sent') ? [{ _msg: 'piano-bridge.supervisor.alert-sent' }] : []; },
  });
  await r.step(30);
  assert.equal(r.pushes.filter((p) => /self-repair/.test(p.title)).length, 0);
  assert.ok(queries.some((q) => q.includes('data.kind:"not-ready"') && q.includes('_time:24h')));
});

test('readiness: with no push target it says so once a day at warn, never error-spams', async () => {
  const r = speakerRig({ notify: false, checkReady: async () => [] });
  await r.step(2 * 60 * 3); // 3 hours
  assert.equal(r.events('piano.speaker.not-ready').length, 1);
  assert.deepEqual(r.events('piano.speaker.not-ready')[0].data.problems, ['no-notify-target']);
  assert.equal(r.events('piano-bridge.supervisor.alert-unsent').length, 0);
});

test('weekly: a recovery a person made after a give-up is not counted as a rung fix', async () => {
  const r = speakerRig({
    start: SUNDAY_EVENING,
    queryLogs: async (q) => (q.includes('weekly-summary') ? [] : [
      row('piano.speaker.dropped'), row('piano.speaker.gave-up'),
      { _msg: 'piano.speaker.recovered', 'data.rung': '5', 'data.alerted': 'true' },
    ]),
  });
  await r.step(1);
  const w = r.pushes.find((p) => /this week/.test(p.title));
  assert.equal(w.message, 'Dropped once, and it needed a person.');
});

test('weekly: drops that ended with the piano switched off read cleanly', async () => {
  const r = speakerRig({ start: SUNDAY_EVENING, queryLogs: async (q) => (q.includes('weekly-summary') ? [] : [row('piano.speaker.dropped'), row('piano.speaker.dropped')]) });
  await r.step(1);
  assert.equal(r.pushes.find((p) => /this week/.test(p.title)).message, 'Dropped 2 times.');
});

test('weekly + readiness queries quote the module name', async () => {
  const queries = [];
  const r = speakerRig({ start: SUNDAY_EVENING, queryLogs: async (q) => { queries.push(q); return []; } });
  await r.step(1);
  assert.ok(queries.length > 0);
  assert.ok(queries.every((q) => q.includes('context.module:"piano-bridge-supervisor"')));
});

test('recovered events carry alerted so the week can be told apart', async () => {
  const r = speakerRig();
  r.down();
  await r.step(3);
  r.up();
  await r.step(1);
  assert.equal(r.events('piano.speaker.recovered')[0].data.alerted, false);
});
