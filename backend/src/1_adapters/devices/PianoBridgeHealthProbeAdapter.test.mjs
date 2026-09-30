import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PianoBridgeHealthProbeAdapter } from './PianoBridgeHealthProbeAdapter.mjs';

const ok = (body) => ({ ok: true, status: 200, json: async () => body });

test('reads BLE state and the echo verdict from /status (ws:// url accepted)', async () => {
  const urls = [];
  const probe = new PianoBridgeHealthProbeAdapter({
    bridgeUrl: 'ws://10.0.0.245:8770/',
    fetchImpl: async (url) => { urls.push(url); return ok({ ok: true, ble: { state: 'CONNECTED' }, outVerified: true }); },
  });
  assert.deepEqual(await probe.readHealth(), { reachable: true, ble: 'CONNECTED', outVerified: true, error: null });
  assert.deepEqual(urls, ['http://10.0.0.245:8770/status']);
});

test('falls back to /loopback when /status has no verdict', async () => {
  const probe = new PianoBridgeHealthProbeAdapter({
    bridgeUrl: 'http://tablet:8770',
    fetchImpl: async (url) => (url.endsWith('/status')
      ? ok({ ble: { state: 'CONNECTED' } })
      : ok({ loopback: { outVerified: false } })),
  });
  assert.equal((await probe.readHealth()).outVerified, false);
});

test('a refused connection is an answer, not a throw', async () => {
  const probe = new PianoBridgeHealthProbeAdapter({
    bridgeUrl: 'http://tablet:8770',
    fetchImpl: async () => { throw new Error('connect ECONNREFUSED'); },
  });
  const h = await probe.readHealth();
  assert.equal(h.reachable, false);
  assert.match(h.error, /ECONNREFUSED/);
});

test('a non-2xx status is unreachable', async () => {
  const probe = new PianoBridgeHealthProbeAdapter({
    bridgeUrl: 'http://tablet:8770',
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
  });
  assert.equal((await probe.readHealth()).reachable, false);
});
