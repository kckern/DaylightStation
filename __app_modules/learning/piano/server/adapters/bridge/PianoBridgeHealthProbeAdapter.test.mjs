import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PianoBridgeHealthProbeAdapter } from "./PianoBridgeHealthProbeAdapter.mjs";

const ok = (body) => ({ ok: true, status: 200, json: async () => body });

test('reads BLE state and the echo verdict from /status (ws:// url accepted)', async () => {
  const urls = [];
  const probe = new PianoBridgeHealthProbeAdapter({
    bridgeUrl: 'ws://10.0.0.245:8770/',
    fetchImpl: async (url) => { urls.push(url); return ok({ ok: true, ble: { state: 'CONNECTED' }, outVerified: true }); },
  });
  assert.deepEqual(await probe.readHealth(), { reachable: true, ble: 'CONNECTED', outVerified: true, speaker: null, error: null });
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

test('reads the A2DP speaker state from /status', async () => {
  const probe = new PianoBridgeHealthProbeAdapter({
    bridgeUrl: 'http://tablet:8770',
    fetchImpl: async () => ok({ ble: { state: 'CONNECTED' }, outVerified: true, speaker: { connected: false } }),
  });
  assert.equal((await probe.readHealth()).speaker, false);
});

test('unreachable bridge reports speaker null', async () => {
  const probe = new PianoBridgeHealthProbeAdapter({
    bridgeUrl: 'http://tablet:8770',
    fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
  });
  assert.equal((await probe.readHealth()).speaker, null);
});

test('the configured headers go on every request (the Android app needs its token header)', async () => {
  const seen = [];
  const probe = new PianoBridgeHealthProbeAdapter({
    bridgeUrl: 'http://tablet:8780',
    headers: { 'X-Daylight-Token': 'tok' },
    fetchImpl: async (url, init) => { seen.push([url, init.headers?.['X-Daylight-Token']]); return ok({ ok: true, ble: { state: 'CONNECTED' }, outVerified: true, speaker: { connected: true } }); },
  });
  const health = await probe.readHealth();
  assert.deepEqual(seen, [['http://tablet:8780/status', 'tok']]);
  assert.equal(health.ble, 'CONNECTED');
  assert.equal(health.outVerified, true);
  assert.equal(health.speaker, true);
});
