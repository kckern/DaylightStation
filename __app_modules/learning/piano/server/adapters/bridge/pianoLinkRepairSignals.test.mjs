import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJamcorderClientReader, createPianoKioskIdleCheck, createTabletScreenReader } from './pianoLinkRepairSignals.mjs';

const json = (body, ok = true, status = 200) => async () => ({ ok, status, json: async () => body });

test('counts the BLE clients the JamCorder itself reports', async () => {
  const urls = [];
  const read = createJamcorderClientReader({
    baseUrl: 'http://jam/',
    fetchImpl: async (url) => { urls.push(url); return { ok: true, json: async () => ({ clients: [{}, {}] }) }; },
  });
  assert.equal(await read(), 2);
  assert.deepEqual(urls, ['http://jam/api/bluetooth/state/get']);
});

test('an empty client list is a real zero', async () => {
  assert.equal(await createJamcorderClientReader({ baseUrl: 'http://jam', fetchImpl: json({ clients: [] }) })(), 0);
});

for (const [name, fetchImpl] of [
  ['an HTTP error', json({}, false, 500)],
  ['a body without a client list', json({ gapDeviceName: 'jam' })],
  ['a network failure', async () => { throw new Error('EHOSTUNREACH'); }],
]) {
  test(`${name} is unknown, never zero`, async () => {
    assert.equal(await createJamcorderClientReader({ baseUrl: 'http://jam', fetchImpl })(), null);
  });
}

test('reads whether the tablet screen is on from the bridge', async () => {
  const urls = [];
  const read = createTabletScreenReader({
    bridgeUrl: 'ws://tablet:8770/',
    fetchImpl: async (url) => { urls.push(url); return { ok: true, json: async () => ({ power: { interactive: false } }) }; },
  });
  assert.equal(await read(), false);
  assert.deepEqual(urls, ['http://tablet:8770/info']);
});

test('an unreadable screen state is unknown', async () => {
  const read = createTabletScreenReader({ bridgeUrl: 'http://t', fetchImpl: async () => { throw new Error('x'); } });
  assert.equal(await read(), null);
});

const row = (msg) => ({ _msg: msg, _time: '2026-11-18T21:00:00Z' });

function idleRig({ mount = null, unmount = null, recent = [row('perf.diagnostics')], screenOn = true } = {}) {
  const queries = [];
  const check = createPianoKioskIdleCheck({
    readScreenOn: async () => screenOn,
    queryLogs: async (q) => {
      queries.push(q);
      if (q.includes('"game.unmount"')) return unmount ? [{ _time: unmount }] : [];
      if (q.includes('"game.mount"')) return mount ? [{ _time: mount }] : [];
      return recent;
    },
  });
  return { check, queries };
}

test('idle: screen on, kiosk telemetry alive, only background events', async () => {
  const { check, queries } = idleRig({ recent: [row('perf.diagnostics'), row('websocket.connected'), row('midi.out.voice')] });
  assert.deepEqual(await check(), { idle: true, reason: null });
  assert.ok(queries.every((q) => q.includes('context.app:piano-kiosk')));
  assert.ok(queries.some((q) => q.includes('_time:5m')));
  assert.ok(queries.some((q) => q.includes('_time:2h')));
});

test('a mounted game blocks even with no recent activity', async () => {
  const { check } = idleRig({ mount: '2026-11-18T20:00:00Z' });
  assert.deepEqual(await check(), { idle: false, reason: 'game' });
});

test('a game unmounted after its mount does not block', async () => {
  const { check } = idleRig({ mount: '2026-11-18T20:00:00Z', unmount: '2026-11-18T20:10:00Z' });
  assert.equal((await check()).idle, true);
});

test('an unreadable game time is an error, not "no game"', async () => {
  const { check } = idleRig({ mount: 'garbage' });
  await assert.rejects(check, /time/);
});

for (const msg of ['chord.identify', 'playback.render_fps', 'keyshift.tap', 'piano.karaoke-play', 'piano.lesson-practice.snapshot', 'midi.out.press', 'some.event.added.next.year']) {
  test(`${msg} counts as someone being there`, async () => {
    const { check } = idleRig({ recent: [row('perf.diagnostics'), row(msg)] });
    assert.deepEqual(await check(), { idle: false, reason: 'activity' });
  });
}

test('a lit screen with no kiosk telemetry cannot be called idle', async () => {
  const { check } = idleRig({ recent: [] });
  assert.deepEqual(await check(), { idle: false, reason: 'no-telemetry' });
});

test('unknown screen state also needs telemetry', async () => {
  const { check } = idleRig({ recent: [], screenOn: null });
  assert.deepEqual(await check(), { idle: false, reason: 'no-telemetry' });
});

test('a dark screen is quiet by design and counts as idle', async () => {
  const { check } = idleRig({ recent: [], screenOn: false });
  assert.deepEqual(await check(), { idle: true, reason: null });
});

test('activity still blocks with the screen off', async () => {
  const { check } = idleRig({ recent: [row('playback.render_fps')], screenOn: false });
  assert.equal((await check()).idle, false);
});

test('a log store failure propagates so the caller fails closed', async () => {
  const check = createPianoKioskIdleCheck({ queryLogs: async () => { throw new Error('down'); }, readScreenOn: async () => true });
  await assert.rejects(check, /down/);
});
