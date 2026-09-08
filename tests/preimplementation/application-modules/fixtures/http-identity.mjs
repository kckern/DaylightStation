/** Native selected middleware graph; no preparation loader or listeners. */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as http from '@daylight/platform/server/system/http/middleware';
import * as privateHttp from '@daylight-internal/platform--server/system/http/middleware';
import * as errors from '@daylight/platform/server/system/utils/errors/infrastructure-error';
import * as privateErrors from '@daylight-internal/platform--server/system/utils/errors/infrastructure-error';
import * as logging from '@daylight/platform/server/system/logging/dispatcher';
import * as testing from '@daylight/platform/server/system/logging/testing';
import * as logger from '@daylight/platform/server/system/logging/logger';
import * as localTime from '@daylight/platform/server/system/logging/local-timestamp';
import * as privateLogging from '@daylight-internal/platform--server/system/logging/dispatcher';
import * as privateLogger from '@daylight-internal/platform--server/system/logging/logger';
import * as privateLocalTime from '@daylight-internal/platform--server/system/logging/local-timestamp';
import * as systemTime from '@daylight/platform/server/system/utils/time';
import * as pureTime from '@daylight/platform/server/domain/core/utils/time';
import { DEFAULT_TIMEZONE } from '@daylight/platform/server/domain/core/utils/timezone';
import expectation from './expectation.json' with { type: 'json' };
import * as uuidResolution from './platform/server/probe-resolution.mjs';
const results = [], diagnostics = [];
const RealDate = Date, realStdout = process.stdout.write, realStderr = process.stderr.write;
let clock = RealDate.parse('2026-09-06T12:00:00.123Z');
const FakeDate = class extends RealDate { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } };
const check = async (id, fn) => {
  clock = RealDate.parse('2026-09-06T12:00:00.123Z');
  testing.resetLogging();
  try { await fn(); results.push({ id, passed: true }); }
  catch (error) { results.push({ id, passed: false, error: error.message }); }
  finally { testing.resetLogging(); }
};
function capture() {
  const events = [];
  logging.initializeLogging({ defaultLevel: 'debug', timezone: 'UTC' }).addTransport({ name: 'memory', send: e => events.push(e) });
  return events;
}
const request = () => ({ method: 'GET', path: '/api/synthetic/17', headers: {}, traceId: 'synthetic-trace' });
function response(statusCode = 200) {
  const res = Object.assign(new EventEmitter(), { statusCode, writableEnded: true, headersSent: false });
  res.status = function (code) { this.statusCode = code; return this; };
  res.json = function (body) { this.body = body; return this; };
  return res;
}
function logRequest(factory, status = 200) {
  const res = response(status); let next = 0;
  factory({ maxPerMinute: 1 })(request(), res, () => { next++; });
  assert.equal(next, 1); res.emit('finish'); res.emit('close');
}
globalThis.Date = FakeDate;
process.stdout.write = chunk => { diagnostics.push(String(chunk)); return true; };
process.stderr.write = chunk => { diagnostics.push(String(chunk)); return true; };
try {
  await check('HTTPN-EXPORTS', async () => {
    for (const facade of expectation.facades) {
      const actual = await import(facade.entry);
      assert.deepEqual(Object.keys(actual).sort(), [...facade.names].sort(), facade.entry);
    }
  });
  await check('HTTPN-MIDDLEWARE-BINDING', async () => {
    for (const name of ['asyncHandler', 'errorHandlerMiddleware', 'requestLoggerMiddleware', 'tracingMiddleware']) assert.equal(http[name], privateHttp[name], name);
    const errorLeaf = await import('./platform/server/system/http/middleware/errorHandler.mjs');
    const logLeaf = await import('./platform/server/system/http/middleware/requestLogger.mjs');
    const traceLeaf = await import('./platform/server/system/http/middleware/tracing.mjs');
    assert.equal(errorLeaf.default, http.errorHandlerMiddleware);
    assert.equal(logLeaf.default, http.requestLoggerMiddleware);
    assert.equal(traceLeaf.default, http.tracingMiddleware);
  });
  await check('HTTPN-ERROR-BINDING', () => {
    for (const [name, value] of Object.entries(errors)) assert.equal(value, privateErrors[name], name);
    assert.equal(privateErrors.isInfrastructureError(new errors.InfrastructureError('synthetic')), true);
    assert.equal(privateErrors.default, errors.InfrastructureError);
  });
  await check('HTTPN-LOGGING-BINDING', () => {
    for (const [name, value] of Object.entries(logging)) assert.equal(value, privateLogging[name], name);
    for (const [name, value] of Object.entries(testing)) assert.equal(value, privateLogging[name], name);
    assert.equal(logger.createLogger, privateLogger.createLogger);
    assert.equal(localTime.formatLocalTimestamp, privateLocalTime.formatLocalTimestamp);
  });
  await check('HTTPN-NAMESPACE', async () => {
    assert.equal(await import('@daylight/platform/server/system/http/middleware'), http);
    assert.equal(await import('@daylight-internal/platform--server/system/http/middleware'), privateHttp);
    assert.notEqual(http, privateHttp);
    for (const facade of expectation.facades) assert.equal(await import(facade.entry), await import(facade.entry));
    for (const entry of ['@daylight/platform/server/system/http/middleware/errorHandler.mjs', '@daylight/platform/server/system/http/middleware.mjs', '@daylight/platform/server/system/utils/errors/index.mjs']) {
      await assert.rejects(import(entry), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
    }
  });
  await check('HTTPN-UUID-RESOLUTION', async () => {
    assert.equal(uuidResolution.version, '11.1.0');
    assert.equal(uuidResolution.esmRelative, 'node_modules/uuid/dist/esm/index.js');
    assert.equal(uuidResolution.cjsRelative, 'node_modules/uuid/dist/cjs/index.js');
    assert.equal((await import(uuidResolution.esmUrl)).v4, uuidResolution.v4);
    await assert.rejects(import('uuid'), { code: 'ERR_MODULE_NOT_FOUND' });
    const req = request(), headers = [];
    http.tracingMiddleware()(req, { setHeader: (...args) => headers.push(args) }, () => {});
    assert.match(req.traceId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.deepEqual(headers, [['X-Trace-Id', req.traceId]]);
  });
  await check('HTTPN-CLASSIFICATION', () => {
    capture();
    const error = new errors.InfrastructureError('synthetic infrastructure'); error.name = 'OpaqueSyntheticError';
    const object = response(), string = response();
    http.errorHandlerMiddleware()(error, request(), object, () => assert.fail('unexpected next'));
    http.errorHandlerMiddleware({ shape: 'string' })(error, request(), string, () => assert.fail('unexpected next'));
    assert.equal(object.statusCode, 503, 'object shape must recognize the public constructor by identity, not name');
    assert.equal(string.statusCode, 500, 'string shape keeps name-based mapping');
    assert.equal(object.body.error.message, 'synthetic infrastructure');
    assert.equal(string.body.error, 'Internal server error');
  });
  await check('HTTPN-ERROR-LOGGING', () => {
    const handler = http.errorHandlerMiddleware(), first = capture();
    handler(new privateErrors.InfrastructureError('first'), request(), response(), () => {});
    const second = capture();
    handler(new privateErrors.InfrastructureError('second'), request(), response(), () => {});
    assert.deepEqual(first.map(e => e.event), ['http.error.infrastructure']);
    assert.deepEqual(second.map(e => e.event), ['http.error.infrastructure']);
    assert.equal(first[0].data.message, 'first'); assert.equal(second[0].data.message, 'second');
    assert.equal(second[0].context.app, 'http');
  });
  await check('HTTPN-REQUEST-LOGGING', () => {
    const events = capture(); logRequest(http.requestLoggerMiddleware, 400);
    assert.equal(events.length, 1); assert.equal(events[0].event, 'http.response');
    assert.equal(events[0].level, 'warn'); assert.equal(events[0].data.path, '/api/synthetic/17');
    assert.equal(events[0].context.app, 'middleware');
  });
  await check('HTTPN-REQUEST-SAMPLING', () => {
    const before = capture(); logRequest(http.requestLoggerMiddleware);
    testing.resetLogging(); const after = capture();
    logRequest(privateHttp.requestLoggerMiddleware);
    assert.equal(before.length, 1); assert.equal(after.length, 0, 'public/private requests share module-created sampling state across reset');
    clock += 60_000; logRequest(http.requestLoggerMiddleware);
    assert.deepEqual(after.map(e => e.event), ['http.response.aggregated', 'http.response']);
    assert.equal(after[0].data.skippedCount, 1); assert.equal(after[0].data.sampledCount, 1);
  });
  await check('HTTPN-CLOCK-AUTHORITY', () => {
    assert.equal(DEFAULT_TIMEZONE, 'America/Los_Angeles');
    assert.equal(new errors.InfrastructureError('time').timestamp, '2026-09-06 05:00:00');
    assert.equal(systemTime.nowTs24(), '2026-09-06 05:00:00');
    assert.throws(() => pureTime.formatLocalTimestamp(), /valid Date/);
    assert.equal(pureTime.formatLocalTimestamp(new Date(), 'UTC'), '2026-09-06 12:00:00');
    assert.equal(localTime.formatLocalTimestamp(new Date(), 'UTC'), '2026-09-06T12:00:00.123+00:00');
    const d = new testing.LogDispatcher({ timezone: 'Asia/Tokyo' });
    assert.equal(d.validate({ event: 'clock-probe' }).ts, '2026-09-06T21:00:00.123+09:00');
    assert.equal(new errors.InfrastructureError('still-LA').timestamp, '2026-09-06 05:00:00');
  });
  await check('HTTPN-ASYNC-CONTRACT', async () => {
    const failure = new Error('synthetic sync'), seen = [];
    assert.throws(() => http.asyncHandler(() => { throw failure; })(request(), response(), e => seen.push(e)), e => e === failure);
    assert.deepEqual(seen, []);
    assert.equal(await http.asyncHandler(() => Promise.reject(failure))(request(), response(), e => { seen.push(e); return 17; }), 17);
    assert.deepEqual(seen, [failure]);
  });
} finally {
  testing.resetLogging(); globalThis.Date = RealDate;
  process.stdout.write = realStdout; process.stderr.write = realStderr;
}
assert.deepEqual(results.map(r => r.id), expectation.probeIds);
const failedIds = results.filter(r => !r.passed).map(r => r.id);
process.stdout.write(JSON.stringify({ passed: failedIds.length === 0, count: results.length, results, failedIds, fallbackDiagnostics: diagnostics.length }) + '\n');
if (failedIds.length) process.exitCode = 1;
