import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PianoBridgeLifelineRestartAdapter } from './PianoBridgeLifelineRestartAdapter.mjs';

test('POSTs /restart on the lifeline with the token header', async () => {
  const calls = [];
  const a = new PianoBridgeLifelineRestartAdapter({
    lifelineBase: 'http://tablet:8781/', headers: { 'X-Daylight-Token': 'tok' },
    fetchImpl: async (url, init) => { calls.push([url, init.method, init.headers['X-Daylight-Token']]); return { ok: true, status: 200 }; },
  });
  assert.deepEqual(await a.restart(), { ok: true });
  assert.deepEqual(calls, [['http://tablet:8781/restart', 'POST', 'tok']]);
});

test('a refusal or no answer is a result, never a throw', async () => {
  const refused = new PianoBridgeLifelineRestartAdapter({ lifelineBase: 'http://t:8781', fetchImpl: async () => ({ ok: false, status: 503 }) });
  assert.deepEqual(await refused.restart(), { ok: false, error: 'lifeline HTTP 503' });
  const down = new PianoBridgeLifelineRestartAdapter({ lifelineBase: 'http://t:8781', fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  assert.deepEqual(await down.restart(), { ok: false, error: 'lifeline ECONNREFUSED' });
});
