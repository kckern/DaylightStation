/** Socket-free equivalents of capabilityRoutes.characterization's three ePaper oracles. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { epaperHttpFixture, stamp } from '../drivers/epaper-http.mjs';
const check = (name, fn) => test('CASE-EPAPER-HTTP-' + name, { timeout: 5000 }, fn);
check('CACHED-PNG-HEADERS', async () => {
  const bytes = Buffer.from([137, 80, 78, 71]);
  const calls = { cached: 0, render: [] };
  const f = epaperHttpFixture({
    getCached() { calls.cached++; return bytes; },
    async render(...args) { calls.render.push(args); return bytes; },
    getStatus: () => ({ configured: true, hasCache: true }),
  });
  const response = await f.request('GET', '/image.png');
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'image/png');
  assert.equal(String(response.headers['content-length']), String(bytes.length));
  assert.equal(response.headers['cache-control'], 'no-cache');
  // The shared dispatcher exposes a UTF-8 body; preserve its exact text contract.
  assert.equal(response.body, bytes.toString());
  assert.equal(calls.cached, 1); assert.deepEqual(calls.render, []);
});
check('RENDER-BODY-AND-RESPONSE', async () => {
  const calls = [];
  const f = epaperHttpFixture({ getCached: () => null,
    async render(...args) { calls.push(args); return Buffer.alloc(9); },
    getStatus: () => ({ configured: true }),
  });
  const response = await f.request('POST', '/render', { body: { weather: 'sunny' } });
  assert.equal(response.status, 200);
  assert.deepEqual(response.json(), { ok: true, sizeBytes: 9, renderedAt: stamp });
  assert.deepEqual(calls, [[{ weather: 'sunny' }]]);
});
check('STATUS-AND-UNCONFIGURED', async () => {
  const unavailable = epaperHttpFixture();
  for (const [method, path] of [['GET', '/status'], ['GET', '/image.png'], ['POST', '/render']]) {
    const response = await unavailable.request(method, path, method === 'POST' ? { body: {} } : undefined);
    assert.equal(response.status, 503);
    assert.deepEqual(response.json(), { error: 'ePaper adapter not configured' });
  }
  let statusCalls = 0;
  const available = epaperHttpFixture({ getCached() {}, render() {},
    getStatus() { statusCalls++; return { configured: true, displaySize: '1600x1200' }; },
  });
  const response = await available.request('GET', '/status');
  assert.equal(response.status, 200);
  assert.deepEqual(response.json(), { configured: true, displaySize: '1600x1200' });
  assert.equal(statusCalls, 1);
});
