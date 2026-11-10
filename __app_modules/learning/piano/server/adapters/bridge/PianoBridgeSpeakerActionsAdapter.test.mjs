import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PianoBridgeSpeakerActionsAdapter } from './PianoBridgeSpeakerActionsAdapter.mjs';

const res = (status, body = { ok: true }) => ({ ok: status < 300, status, json: async () => body });

test('a2dpReconnect POSTs /speaker/reconnect', async () => {
  const calls = [];
  const a = new PianoBridgeSpeakerActionsAdapter({
    bridgeUrl: 'ws://tablet:8770/',
    fetchImpl: async (url, init) => { calls.push([url, init.method]); return res(200); },
  });
  assert.deepEqual(await a.a2dpReconnect(), { ok: true, error: null });
  assert.deepEqual(calls, [['http://tablet:8770/speaker/reconnect', 'POST']]);
});

test('bluetoothCycle POSTs /speaker/bt-cycle with settleMs', async () => {
  const calls = [];
  const a = new PianoBridgeSpeakerActionsAdapter({
    bridgeUrl: 'http://tablet:8770',
    fetchImpl: async (url) => { calls.push(url); return res(200); },
  });
  await a.bluetoothCycle(15000);
  assert.deepEqual(calls, ['http://tablet:8770/speaker/bt-cycle?settleMs=15000']);
});

test('an older payload without the endpoint is endpoint-missing, not a throw', async () => {
  const a = new PianoBridgeSpeakerActionsAdapter({ bridgeUrl: 'http://tablet:8770', fetchImpl: async () => res(404) });
  assert.deepEqual(await a.a2dpReconnect(), { ok: false, error: 'endpoint-missing' });
});

test('bridge saying ok:false surfaces its error', async () => {
  const a = new PianoBridgeSpeakerActionsAdapter({
    bridgeUrl: 'http://tablet:8770',
    fetchImpl: async () => res(200, { ok: false, error: 'busy' }),
  });
  assert.deepEqual(await a.bluetoothCycle(5000), { ok: false, error: 'busy' });
});

test('network failure resolves, never rejects', async () => {
  const a = new PianoBridgeSpeakerActionsAdapter({
    bridgeUrl: 'http://tablet:8770',
    fetchImpl: async () => { throw new Error('ECONNRESET'); },
  });
  const r = await a.a2dpReconnect();
  assert.equal(r.ok, false);
  assert.match(r.error, /ECONNRESET/);
});

test('probeEndpoints: "POST only" means present, 404 means missing, network error means unknown', async () => {
  const seen = [];
  const present = new PianoBridgeSpeakerActionsAdapter({
    bridgeUrl: 'http://tablet:8770',
    fetchImpl: async (url, init) => { seen.push([url, init.method]); return res(200, { ok: false, error: 'POST only' }); },
  });
  assert.deepEqual(await present.probeEndpoints(), { present: true });
  assert.deepEqual(seen, [['http://tablet:8770/speaker/reconnect', 'GET'], ['http://tablet:8770/speaker/bt-cycle', 'GET']]);

  const old = new PianoBridgeSpeakerActionsAdapter({ bridgeUrl: 'http://tablet:8770', fetchImpl: async () => res(404) });
  assert.deepEqual(await old.probeEndpoints(), { present: false });

  const down = new PianoBridgeSpeakerActionsAdapter({ bridgeUrl: 'http://tablet:8770', fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  assert.deepEqual(await down.probeEndpoints(), { present: null });
});
