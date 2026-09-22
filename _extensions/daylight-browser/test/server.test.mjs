import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createRequestHandler } from '../src/server.mjs';
import { createOperationRegistry } from '../src/operationRegistry.mjs';
import { DAYLIGHT_BROWSER_TIMEOUTS, validateTimeoutHierarchy } from '../src/timeouts.mjs';

async function request(handler, { path = '/v1/operations/fixture.inspect', method = 'POST', body = '{}', type = 'application/json' } = {}) {
  const req = Readable.from([body]);
  Object.assign(req, { url: path, method, headers: { 'content-type': type } });
  const response = new (await import('node:events')).EventEmitter();
  response.setHeader = () => {};
  response.end = value => { response.body = JSON.parse(value); response.writableEnded = true; };
  await handler(req, response);
  return response;
}

test('HTTP surface rejects unknown operations, unsupported methods, malformed/oversized JSON', async () => {
  let calls = 0;
  const registry = createOperationRegistry([{ name: 'fixture.inspect', validate: value => value, execute: async () => { calls++; return { ok: true }; } }]);
  const handler = createRequestHandler({ registry, logger: () => {} });
  assert.equal((await request(handler)).statusCode, 200);
  for (const path of ['/browse', '/v1/operations/evaluate', '/v1/operations/fixture.inspect?url=private']) assert.equal((await request(handler, { path })).statusCode, 404);
  for (const overrides of [{ method: 'GET' }, { body: '{' }, { body: ' '.repeat(65537) }, { type: 'text/plain' }]) assert.equal((await request(handler, overrides)).statusCode, 400);
  assert.equal(calls, 1);
  assert.equal((await request(handler, { path: '/health', method: 'GET' })).body.status, 'ok');
});

test('validated operations log only correlation ID and categorical outcome on success and failure', async () => {
  const logs = [];
  const validate = value => {
    if (!/^[a-z0-9-]+$/.test(value.operationId || '')) throw Object.assign(new Error(), { code: 'BROWSER_INVALID_REQUEST' });
    return value;
  };
  const successRegistry = createOperationRegistry([{ name: 'fixture.inspect', validate, execute: async () => ({ ok: true, capability: 'signed-secret' }) }]);
  await request(createRequestHandler({ registry: successRegistry, logger: value => logs.push(value) }), {
    body: '{"webUrl":"https://secret.test","message":"secret","operationId":"op-safe-1"}',
  });
  const registry = createOperationRegistry([{ name: 'fixture.inspect', validate, execute: async () => { throw new Error('https://secret.test/token=private'); } }]);
  const response = await request(createRequestHandler({ registry, logger: value => logs.push(value) }), { body: '{"message":"secret","operationId":"op-safe-2"}' });
  assert.equal(response.statusCode, 502);
  assert.deepEqual(response.body, { error: { code: 'BROWSER_FAILED' } });
  assert.deepEqual(logs.map(({ operationId, outcome }) => ({ operationId, outcome })), [
    { operationId: 'op-safe-1', outcome: 'BROWSER_OK' },
    { operationId: 'op-safe-2', outcome: 'BROWSER_FAILED' },
  ]);
  assert.equal(JSON.stringify(logs).includes('signed-secret'), false);
  assert.equal(JSON.stringify(logs).includes('secret.test'), false);
  assert.equal(JSON.stringify(logs).includes('secret'), false);
});

test('pre-validation failures log no caller-controlled operation ID', async () => {
  const logs = [];
  const registry = createOperationRegistry([{ name: 'fixture.inspect', validate: () => { throw Object.assign(new Error(), { code: 'BROWSER_INVALID_REQUEST' }); }, execute: async () => ({}) }]);
  await request(createRequestHandler({ registry, logger: value => logs.push(value) }), { body: '{"operationId":"caller-secret"}' });
  assert.equal(logs[0].operationId, null);
  assert.equal(JSON.stringify(logs).includes('caller-secret'), false);
});

test('known failure categories map to their HTTP status without trusting arbitrary error data', async () => {
  for (const [code, status] of [['BROWSER_INVALID_REQUEST', 400], ['BROWSER_OPERATION_UNKNOWN', 404], ['BROWSER_BUSY', 409], ['BROWSER_UNSUPPORTED_FULFILLMENT', 422], ['BROWSER_FAILED', 502], ['BROWSER_TIMEOUT', 504]]) {
    const handler = createRequestHandler({ registry: { dispatch: async () => { throw Object.assign(new Error('private'), { code }); } }, logger: () => {} });
    assert.equal((await request(handler)).statusCode, status);
  }
});

test('outer browser deadlines cover navigation, initial capture, and bounded cleanup', () => {
  assert.doesNotThrow(() => validateTimeoutHierarchy(DAYLIGHT_BROWSER_TIMEOUTS));
  assert.equal(DAYLIGHT_BROWSER_TIMEOUTS.captureObservationMs, 20_000);
  assert.ok(DAYLIGHT_BROWSER_TIMEOUTS.captureMs >= DAYLIGHT_BROWSER_TIMEOUTS.captureObservationMs);
  assert.ok(DAYLIGHT_BROWSER_TIMEOUTS.operationMs
    > DAYLIGHT_BROWSER_TIMEOUTS.navigationMs + DAYLIGHT_BROWSER_TIMEOUTS.captureMs + DAYLIGHT_BROWSER_TIMEOUTS.cleanupMs);
  assert.ok(DAYLIGHT_BROWSER_TIMEOUTS.httpRequestMs > DAYLIGHT_BROWSER_TIMEOUTS.operationMs);
  for (const invalid of [
    { ...DAYLIGHT_BROWSER_TIMEOUTS, captureObservationMs: DAYLIGHT_BROWSER_TIMEOUTS.captureMs + 1 },
    { ...DAYLIGHT_BROWSER_TIMEOUTS, operationMs: DAYLIGHT_BROWSER_TIMEOUTS.navigationMs + DAYLIGHT_BROWSER_TIMEOUTS.captureMs },
    { ...DAYLIGHT_BROWSER_TIMEOUTS, httpRequestMs: DAYLIGHT_BROWSER_TIMEOUTS.operationMs },
  ]) assert.throws(() => validateTimeoutHierarchy(invalid), /timeout hierarchy/);
});
