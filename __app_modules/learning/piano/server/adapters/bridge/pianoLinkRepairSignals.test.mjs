import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJamcorderClientReader, createPianoKioskIdleCheck } from './pianoLinkRepairSignals.mjs';

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

function idleRig({ mount = null, unmount = null, active = [] } = {}) {
  const queries = [];
  const check = createPianoKioskIdleCheck({
    queryLogs: async (q) => {
      queries.push(q);
      if (q.includes('"game.unmount"')) return unmount ? [{ _time: unmount }] : [];
      if (q.includes('| limit 1')) return mount ? [{ _time: mount }] : [];
      return active;
    },
  });
  return { check, queries };
}

test('idle when no game is on screen and nobody has touched the kiosk', async () => {
  const { check, queries } = idleRig();
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

test('recent human activity blocks', async () => {
  const { check } = idleRig({ active: [{ _msg: 'chord.identify' }] });
  assert.deepEqual(await check(), { idle: false, reason: 'activity' });
});

test('a log store failure propagates so the caller fails closed', async () => {
  const check = createPianoKioskIdleCheck({ queryLogs: async () => { throw new Error('down'); } });
  await assert.rejects(check, /down/);
});
