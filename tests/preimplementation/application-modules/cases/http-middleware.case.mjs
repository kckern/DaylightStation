/** Original middleware contracts over synthetic objects/events; no listeners. */
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { asyncHandler, errorHandlerMiddleware, requestLoggerMiddleware, tracingMiddleware } from '../../../../backend/src/0_system/http/middleware/index.mjs';
import { initializeLogging, resetLogging } from '../../../../backend/src/0_system/logging/dispatcher.mjs';
import { InfrastructureError } from '../../../../backend/src/0_system/utils/errors/InfrastructureError.mjs';

let events;
beforeEach(() => {
  resetLogging(); events = [];
  initializeLogging({ defaultLevel: 'debug', timezone: 'UTC' }).addTransport({ name: 'memory', send: event => events.push(event) });
});
afterEach(() => { resetLogging(); });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const req = overrides => ({ method: 'GET', path: '/api/example/17', headers: {}, ...overrides });
function response(overrides = {}) {
  const value = Object.assign(new EventEmitter(), { writableEnded: true, statusCode: 200, headersSent: false, calls: [], ...overrides });
  value.status = function (code) { this.calls.push(['status', code]); this.statusCode = code; return this; };
  value.json = function (body) { this.calls.push(['json', body]); this.body = body; this.wireBody = JSON.parse(JSON.stringify(body)); return this; };
  return value;
}
function capturedLogger() {
  const calls = [];
  return { calls, sampled: (...args) => calls.push({ method: 'sampled', args }), warn: (...args) => calls.push({ method: 'warn', args }) };
}
function requestLog(request = req(), res = response(), options = {}) {
  const logger = capturedLogger(); let next = 0;
  requestLoggerMiddleware({ ...options, logger })(request, res, () => { next++; });
  assert.equal(next, 1);
  return { logger, res, request, finish: () => { res.emit('finish'); return logger.calls[0]; } };
}
const error = (name = 'Error', extra = {}) => Object.assign(new Error('synthetic internal detail'), { name, ...extra });
function handle(err, options = {}, request = req({ traceId: 'audit-trace' }), res = response(), next = () => { throw new Error('unexpected next'); }) {
  const returned = errorHandlerMiddleware(options)(err, request, res, next);
  return { res, returned };
}

test('CASE-HTTP-ASYNC-IMMEDIATE invokes the original handler synchronously with unchanged arguments', async () => {
  const request = req(), res = response(), next = () => { throw new Error('unexpected next'); };
  let called = false;
  const returned = asyncHandler(function (...args) { called = true; assert.deepEqual(args, [request, res, next]); assert.equal(this, undefined); return 17; })(request, res, next);
  assert.equal(called, true); assert.equal(returned instanceof Promise, true); assert.equal(await returned, 17);
});
test('CASE-HTTP-ASYNC-RESOLVE returns a distinct promise chain with the original resolved value', async () => {
  const value = {}, original = Promise.resolve(value);
  const returned = asyncHandler(() => original)(req(), response(), () => assert.fail('unexpected next'));
  assert.notEqual(returned, original); assert.equal(await returned, value);
});
test('CASE-HTTP-ASYNC-REJECTION forwards the identical rejected error once and returns next result', async () => {
  const failure = new Error('synthetic rejection'), calls = [], result = {};
  const returned = asyncHandler(() => Promise.reject(failure))(req(), response(), err => { calls.push(err); return result; });
  assert.equal(await returned, result); assert.deepEqual(calls, [failure]);
});
test('CASE-HTTP-ASYNC-SYNC-THROW preserves synchronous throw without calling next', () => {
  const failure = new Error('synthetic synchronous failure'); let called = 0;
  assert.throws(() => asyncHandler(() => { throw failure; })(req(), response(), () => { called++; }), err => err === failure);
  assert.equal(called, 0);
});
test('CASE-HTTP-ASYNC-THENABLE preserves native promise assimilation timing', async () => {
  const order = [];
  const result = asyncHandler(() => { order.push('handler'); return { then(resolve) { order.push('then'); resolve(9); } }; })(req(), response(), () => assert.fail('unexpected next'));
  order.push('returned'); assert.deepEqual(order, ['handler', 'returned']);
  assert.equal(await result, 9); assert.deepEqual(order, ['handler', 'returned', 'then']);
});
test('CASE-HTTP-ASYNC-NEXT-THROWS rejects with next error when the error callback throws', async () => {
  const original = new Error('original'), following = new Error('next threw'); let count = 0;
  await assert.rejects(asyncHandler(() => Promise.reject(original))(req(), response(), err => { assert.equal(err, original); count++; throw following; }), err => err === following);
  assert.equal(count, 1);
});

test('CASE-HTTP-TRACE-PRESERVE passes truthy incoming values unchanged without normalization', () => {
  for (const value of ['audit-trace', '  spaced  ', ['a', 'b'], 7]) {
    const request = req({ headers: { 'x-trace-id': value }, traceId: 'previous' }), calls = []; let next = 0;
    tracingMiddleware()(request, { setHeader: (...args) => calls.push(args) }, () => { next++; });
    assert.equal(request.traceId, value); assert.deepEqual(calls, [['X-Trace-Id', value]]); assert.equal(next, 1);
  }
});
test('CASE-HTTP-TRACE-MINT mints fresh UUIDs for each falsy header and overwrites a previous request ID', () => {
  const minted = new Set();
  for (const value of [undefined, null, '', 0, false]) {
    const request = req({ headers: { 'x-trace-id': value }, traceId: 'previous' });
    tracingMiddleware()(request, { setHeader(name, id) { assert.equal(name, 'X-Trace-Id'); assert.equal(id, request.traceId); } }, () => {});
    assert.match(request.traceId, uuid); minted.add(request.traceId);
  }
  assert.equal(minted.size, 5);
});
test('CASE-HTTP-TRACE-ORDER sets request then response then next and discards next return value', () => {
  const order = [], request = req(); let id;
  Object.defineProperty(request, 'traceId', { get: () => id, set(value) { id = value; order.push('request'); } });
  const returned = tracingMiddleware()(request, { setHeader(name, value) { assert.equal(value, id); order.push('response'); } }, () => { order.push('next'); return 'ignored'; });
  assert.equal(returned, undefined); assert.deepEqual(order, ['request', 'response', 'next']);
});
test('CASE-HTTP-TRACE-FAILURE preserves missing headers and response-header failure ordering', () => {
  let next = 0;
  assert.throws(() => tracingMiddleware()({}, {}, () => { next++; }), TypeError);
  const request = req(), failure = new Error('synthetic header failure');
  assert.throws(() => tracingMiddleware()(request, { setHeader() { throw failure; } }, () => { next++; }), err => err === failure);
  assert.match(request.traceId, uuid); assert.equal(next, 0);
});

test('CASE-HTTP-LOG-HOOK-ORDER attaches finish and close before next without replacing json', () => {
  const res = response(), json = res.json, logger = capturedLogger();
  const returned = requestLoggerMiddleware({ logger })(req(), res, () => {
    assert.equal(res.listenerCount('finish'), 1); assert.equal(res.listenerCount('close'), 1); assert.equal(res.json, json); return 'ignored';
  });
  assert.equal(returned, undefined); assert.equal(logger.calls.length, 0);
});
test('CASE-HTTP-LOG-COMPLETION reads elapsed milliseconds and completed response fields', t => {
  let clock = 1000; t.mock.method(Date, 'now', () => clock);
  const h = requestLog(req({ method: 'POST', headers: { 'user-agent': 'Audit/1' } }), response({ statusCode: 201 }));
  clock = 1023; const call = h.finish(), data = call.args[1];
  assert.equal(call.method, 'sampled'); assert.equal(call.args[0], 'http.response');
  assert.equal(data.method, 'POST'); assert.equal(data.status, 201); assert.equal(data.statusClass, '2xx');
  assert.equal(data.durationMs, 23); assert.equal(data.userAgent, 'Audit/1'); assert.equal(data.aborted, false);
});
test('CASE-HTTP-LOG-ONCE records exactly once across repeated finish and close in either order', () => {
  for (const first of ['finish', 'close']) {
    const h = requestLog(req(), response({ writableEnded: first === 'finish' }));
    h.res.emit(first); h.res.writableEnded = true; h.res.emit('finish'); h.res.emit('close');
    assert.equal(h.logger.calls.length, 1); assert.equal(h.logger.calls[0].args[1].aborted, first === 'close');
  }
});
test('CASE-HTTP-LOG-STATUS samples successes and redirects but warns on every 4xx or 5xx', () => {
  for (const status of [200, 302, 399, 400, 404, 500, 599]) {
    const h = requestLog(req(), response({ statusCode: status })), call = h.finish();
    assert.equal(call.method, status >= 400 ? 'warn' : 'sampled');
    assert.equal(call.args[1].statusClass, Math.floor(status / 100) + 'xx');
    assert.equal(call.args.length, status >= 400 ? 2 : 3);
  }
});
test('CASE-HTTP-LOG-ABORT warns even for a nominal 200 when the response never ended', () => {
  const h = requestLog(req(), response({ writableEnded: false })); h.res.emit('close');
  assert.equal(h.logger.calls[0].method, 'warn'); assert.equal(h.logger.calls[0].args[1].status, 200); assert.equal(h.logger.calls[0].args[1].aborted, true);
});
test('CASE-HTTP-LOG-BUDGET preserves default and explicit zero null or custom budgets', () => {
  for (const [value, expected] of [[undefined, 30], [0, 0], [null, null], [7, 7]]) {
    const h = requestLog(req(), response(), { maxPerMinute: value });
    assert.deepEqual(h.finish().args[2], { maxPerMinute: expected });
  }
});
test('CASE-HTTP-LOG-PRIVACY never reads body query url or originalUrl and emits only approved fields', () => {
  const request = req({ path: '/proxy/plex/17' });
  for (const name of ['body', 'query', 'url', 'originalUrl']) Object.defineProperty(request, name, { get() { throw new Error('PRIVATE_FIELD_READ:' + name); } });
  const data = requestLog(request).finish().args[1];
  assert.deepEqual(Object.keys(data).sort(), ['aborted', 'deviceId', 'deviceIdSource', 'durationMs', 'method', 'path', 'route', 'status', 'statusClass', 'userAgent']);
  assert.equal(data.path, '/proxy/plex/17'); assert.equal(data.route, '/proxy/plex');
});
test('CASE-HTTP-LOG-GROUP preserves first-two-segment grouping and falsy path behavior', () => {
  for (const [value, group] of [['/proxy/plex/stream/17', '/proxy/plex'], ['///a//b//c', '/a/b'], ['/', '/'], [undefined, '/'], ['', '/'], [0, '/'], [42, '/42']]) {
    const data = requestLog(req({ path: value })).finish().args[1];
    assert.equal(data.path, value); assert.equal(data.route, group);
  }
});
test('CASE-HTTP-LOG-PROVENANCE preserves absent versus empty device and user-agent fields', () => {
  for (const [agent, device, origin] of [[undefined, undefined, undefined], [null, null, null], ['', 0, 'header'], ['Audit', false, 'user-agent'], ['Audit', null, 'none']]) {
    const data = requestLog(req({ headers: { 'user-agent': agent }, deviceId: device, deviceIdSource: origin })).finish().args[1];
    assert.equal(data.userAgent, agent ?? null); assert.equal(data.deviceId, device ?? null); assert.equal(data.deviceIdSource, origin ?? 'unresolved');
  }
});
test('CASE-HTTP-LOG-LATE-FIELDS reads resolver and response state at completion rather than mount time', () => {
  const h = requestLog(); h.request.deviceId = 'audit-device'; h.request.deviceIdSource = 'header'; h.request.path = '/late/path/item'; h.res.statusCode = 503;
  const data = h.finish().args[1];
  assert.equal(data.deviceId, 'audit-device'); assert.equal(data.deviceIdSource, 'header'); assert.equal(data.path, '/late/path/item'); assert.equal(data.status, 503);
});
test('CASE-HTTP-LOG-NEXT-THROW keeps listeners when downstream next throws', () => {
  const res = response(), logger = capturedLogger(), failure = new Error('next failed');
  assert.throws(() => requestLoggerMiddleware({ logger })(req(), res, () => { throw failure; }), err => err === failure);
  assert.equal(res.listenerCount('finish'), 1); assert.equal(res.listenerCount('close'), 1);
  res.emit('finish'); assert.equal(logger.calls.length, 1);
});
test('CASE-HTTP-LOG-DEFAULT uses the module-created real logger with the current dispatcher', () => {
  const res = response({ statusCode: 500 }); requestLoggerMiddleware()(req(), res, () => {}); res.emit('finish');
  assert.equal(events.length, 1); assert.equal(events[0].event, 'http.response'); assert.equal(events[0].level, 'warn');
  assert.equal(events[0].context.source, 'http'); assert.equal(events[0].context.app, 'middleware');
});

test('CASE-HTTP-ERROR-NAMES preserves the complete named status mapping in both shapes', () => {
  const statuses = { ValidationError: 400, EntityNotFoundError: 404, NotFoundError: 404, AuthorizationError: 403, DomainInvariantError: 422, BusinessRuleError: 422, DomainError: 422, ConflictError: 409, ConfigurationError: 503, InfrastructureError: 503, SchedulerError: 503, PersistenceError: 503, ExternalServiceError: 503, TimeoutError: 503, Error: 500 };
  for (const [name, status] of Object.entries(statuses)) for (const shape of ['object', 'string']) assert.equal(handle(error(name), { shape }).res.statusCode, status, name + ':' + shape);
});
test('CASE-HTTP-ERROR-EXPLICIT preserves finite status and nullish statusCode precedence', () => {
  for (const [status, statusCode, expected] of [[418, 503, 418], [null, 418, 418], [undefined, 429, 429], ['418', 429, 400], [Infinity, 429, 400], [NaN, 429, 400], [0, 429, 0], [200.5, 429, 200.5]]) {
    for (const shape of ['object', 'string']) assert.equal(handle(error('ValidationError', { status, statusCode }), { shape }).res.statusCode, expected);
  }
});
test('CASE-HTTP-ERROR-INFRA preserves object-instance versus string-name status differences', () => {
  const failure = new InfrastructureError('synthetic infrastructure'); failure.name = 'ValidationError';
  assert.equal(handle(failure).res.statusCode, 503); assert.equal(events.at(-1).event, 'http.error.domain'); assert.equal(events.at(-1).level, 'warn');
  assert.equal(handle(failure, { shape: 'string' }).res.statusCode, 400);
  failure.name = 'Unrecognized';
  assert.equal(handle(failure).res.statusCode, 503); assert.equal(events.at(-1).event, 'http.error.infrastructure');
  assert.equal(handle(failure, { shape: 'string' }).res.statusCode, 500);
});
test('CASE-HTTP-ERROR-STRING-SAFE returns expected messages and omits absent code on serialization', () => {
  const res = handle(error('ValidationError'), { shape: 'string' }).res;
  assert.deepEqual(res.body, { error: 'synthetic internal detail', code: undefined });
  assert.deepEqual(res.wireBody, { error: 'synthetic internal detail' });
  assert.deepEqual(handle(error('ConflictError', { code: 'CONFLICT' }), { shape: 'string' }).res.wireBody, { error: 'synthetic internal detail', code: 'CONFLICT' });
});
test('CASE-HTTP-ERROR-STRING-HIDE hides unexpected messages while retaining real server-side details', () => {
  for (const [code, expected] of [[undefined, 'INTERNAL'], ['', 'INTERNAL'], [0, 'INTERNAL'], ['OPAQUE', 'OPAQUE']]) {
    const failure = error('Error', { code }), res = handle(failure, { shape: 'string' }).res;
    assert.deepEqual(res.wireBody, { error: 'Internal server error', code: expected });
    assert.equal(events.at(-1).event, 'http.error.unexpected'); assert.equal(events.at(-1).data.message, failure.message); assert.equal(events.at(-1).data.stack, failure.stack);
  }
});
test('CASE-HTTP-ERROR-OBJECT-EXPOSE preserves the legacy nested unexpected-error response', () => {
  const res = handle(error()).res;
  assert.deepEqual(res.wireBody, { ok: false, error: { type: 'Error', message: 'synthetic internal detail' }, traceId: 'audit-trace' });
  assert.equal(res.statusCode, 500);
});
test('CASE-HTTP-ERROR-STRING-WEBHOOK keeps string body but responds 200 for expected and unexpected errors', () => {
  for (const [name, actualStatus, message] of [['ValidationError', 400, 'synthetic internal detail'], ['Error', 500, 'Internal server error']]) {
    const res = handle(error(name, { code: 'CODE' }), { shape: 'string', isWebhook: true }).res;
    assert.equal(res.statusCode, 200); assert.deepEqual(res.wireBody, { error: message, code: 'CODE' });
    assert.equal(events.at(-1).event, 'http.webhook.errorResponse'); assert.equal(events.at(-1).data.actualStatus, actualStatus); assert.equal(events.at(-1).data.returnedStatus, 200);
  }
});
test('CASE-HTTP-ERROR-OBJECT-WEBHOOK preserves ok true error envelope and error-before-webhook logging', () => {
  const res = handle(error(), { isWebhook: true }).res;
  assert.equal(res.statusCode, 200); assert.deepEqual(res.wireBody, { ok: true, error: { type: 'Error', message: 'synthetic internal detail' }, traceId: 'audit-trace' });
  assert.deepEqual(events.map(e => e.event), ['http.error.unknown', 'http.webhook.errorResponse']);
});
test('CASE-HTTP-ERROR-HEADERS-SENT delegates only string mode and preserves the next return', () => {
  const failure = error(), res = response({ headersSent: true }), result = {}; let next = 0;
  const handled = handle(failure, { shape: 'string' }, req(), res, err => { assert.equal(err, failure); next++; return result; });
  assert.equal(handled.returned, result); assert.equal(next, 1); assert.deepEqual(res.calls, []); assert.equal(events.length, 0);
  const legacy = handle(failure, {}, req(), response({ headersSent: true }));
  assert.equal(legacy.res.calls.length, 2); assert.equal(events.length, 1);
});
test('CASE-HTTP-ERROR-TRACE-NULLISH keeps falsy object trace values and uses nullish ID fallback', () => {
  for (const value of ['', false, 0, 'explicit']) assert.equal(handle(error(), {}, req({ traceId: value, id: 'fallback' })).res.body.traceId, value);
  for (const value of [null, undefined]) assert.equal(handle(error(), {}, req({ traceId: value, id: 'fallback' })).res.body.traceId, 'fallback');
  assert.equal(handle(error(), {}, req({ id: 0 })).res.body.traceId, 0);
  assert.match(handle(error(), {}, req()).res.body.traceId, uuid);
});
test('CASE-HTTP-ERROR-STRING-TRACE uses truthy trace or unknown and does not use req id', () => {
  for (const value of ['', false, 0, null, undefined, 'explicit']) {
    const res = handle(error(), { shape: 'string' }, req({ traceId: value, id: 'ignored' })).res;
    assert.equal(events.at(-1).data.traceId, value || 'unknown'); assert.equal(Object.hasOwn(res.body, 'traceId'), false);
  }
});
test('CASE-HTTP-ERROR-SHAPE defaults every non-string shape to the object branch', () => {
  for (const shape of [undefined, null, 'unknown']) assert.equal(handle(error(), { shape }).res.body.ok, false);
  assert.throws(() => errorHandlerMiddleware(null), TypeError);
});
test('CASE-HTTP-ERROR-LOG-CLASSIFICATION preserves name-based object logging versus status-based string logging', () => {
  const failure = error('ValidationError', { status: 503 });
  handle(failure); assert.equal(events.at(-1).level, 'warn'); assert.equal(events.at(-1).event, 'http.error.domain');
  handle(failure, { shape: 'string' }); assert.equal(events.at(-1).level, 'error'); assert.equal(events.at(-1).event, 'http.error.unexpected');
});
test('CASE-HTTP-ERROR-NULL preserves string null-error fallback and object null-error failure', () => {
  assert.deepEqual(handle(null, { shape: 'string' }).res.wireBody, { error: 'Internal server error', code: 'INTERNAL' });
  const res = response(); assert.throws(() => handle(null, {}, req(), res), TypeError); assert.deepEqual(res.calls, []);
});
test('CASE-HTTP-ERROR-RETURN preserves object undefined versus string and webhook response returns', () => {
  assert.equal(handle(error()).returned, undefined);
  for (const options of [{ shape: 'string' }, { isWebhook: true }, { isWebhook: true, shape: 'string' }]) {
    const handled = handle(error(), options); assert.equal(handled.returned, handled.res);
  }
});
