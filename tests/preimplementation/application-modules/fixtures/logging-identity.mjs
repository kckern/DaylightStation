/** Actual original logging bodies through native disposable package exports. */
import assert from 'node:assert/strict';
import { createLogger } from '@daylight/platform/server/system/logging/logger';
import * as dispatcher from '@daylight/platform/server/system/logging/dispatcher';
import * as testing from '@daylight/platform/server/system/logging/testing';
import * as time from '@daylight/platform/server/system/logging/local-timestamp';
import * as privateDispatcher from '@daylight-internal/platform--server/system/logging/dispatcher';
import * as privateLogger from '@daylight-internal/platform--server/system/logging/logger';
import * as privateTime from '@daylight-internal/platform--server/system/logging/local-timestamp';
const ids = [], check = async (id, fn) => { await fn(); ids.push(id); };
const RealDate = Date;
let clock = Date.parse('2026-09-06T12:00:00.123Z');
const FakeDate = class extends RealDate { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } };
const originalWrite = process.stderr.write;
const priority = testing.LEVEL_PRIORITY.debug;
globalThis.Date = FakeDate;
try {
  await check('LOGGING-PUBLIC-EXPORTS', () => {
    assert.deepEqual(Object.keys(dispatcher).sort(), ['getDispatcher', 'initializeLogging', 'isLoggingInitialized'], 'LOGGING-PUBLIC-EXPORTS');
    assert.deepEqual(Object.keys(testing).sort(), ['LEVEL_PRIORITY', 'LogDispatcher', 'resetLogging']);
    assert.deepEqual(Object.keys(time), ['formatLocalTimestamp']);
  });
  await check('LOGGING-BINDING', () => {
    for (const [name, value] of Object.entries(dispatcher)) assert.equal(value, privateDispatcher[name], 'LOGGING-BINDING:' + name);
    for (const [name, value] of Object.entries(testing)) assert.equal(value, privateDispatcher[name], 'LOGGING-BINDING:' + name);
    assert.equal(createLogger, privateLogger.createLogger);
    assert.equal(time.formatLocalTimestamp, privateTime.formatLocalTimestamp);
    assert.equal(privateLogger.default, createLogger);
    assert.equal(privateDispatcher.default, dispatcher.getDispatcher);
    assert.equal(privateTime.default, time.formatLocalTimestamp);
  });
  await check('LOGGING-NAMESPACE', async () => {
    assert.equal(await import('@daylight/platform/server/system/logging/dispatcher'), dispatcher);
    assert.equal(await import('@daylight/platform/server/system/logging/testing'), testing);
    assert.notEqual(dispatcher, privateDispatcher);
    await assert.rejects(import('@daylight/platform/server/system/logging/dispatcher.mjs'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
  });
  await check('LOGGING-PREINIT', () => {
    testing.resetLogging();
    assert.equal(dispatcher.isLoggingInitialized(), false);
    assert.throws(() => dispatcher.getDispatcher(), /not initialized/);
  });
  await check('LOGGING-LATE-DISPATCH', () => {
    const logger = createLogger({ context: { marker: 'synthetic' } }), first = [], second = [];
    let flushes = 0;
    const a = dispatcher.initializeLogging({ defaultLevel: 'debug', timezone: 'UTC' });
    a.addTransport({ name: 'first', send: e => first.push(e), flush: async () => { flushes++; } });
    logger.info('before-reinitialize');
    const b = dispatcher.initializeLogging({ defaultLevel: 'debug' });
    b.addTransport({ name: 'second', send: e => second.push(e) });
    logger.info('after-reinitialize');
    assert.notEqual(a, b); assert.equal(privateDispatcher.getDispatcher(), b);
    assert.deepEqual(first.map(e => e.event), ['before-reinitialize']);
    assert.deepEqual(second.map(e => e.event), ['after-reinitialize']);
    assert.equal(second[0].context.marker, 'synthetic'); assert.equal(flushes, 0);
  });
  await check('LOGGING-TIMESTAMP-PRECEDENCE', () => {
    const events = [], d = dispatcher.initializeLogging({ timezone: 'America/New_York' });
    d.addTransport({ name: 'memory', send: e => events.push(e) });
    createLogger().info('logger-stamps-runtime-zone');
    d.dispatch({ level: 'info', event: 'dispatcher-stamps-configured-zone' });
    d.dispatch({ level: 'info', event: 'caller-ts-wins', ts: 'caller-value' });
    assert.equal(events[0].ts, '2026-09-06T12:00:00.123+00:00');
    assert.equal(events[1].ts, '2026-09-06T08:00:00.123-04:00');
    assert.equal(events[2].ts, 'caller-value');
  });
  await check('LOGGING-GLOBAL-TIMEZONE', () => {
    const d = dispatcher.getDispatcher();
    new testing.LogDispatcher({ timezone: 'Asia/Tokyo' });
    assert.equal(d.validate({ event: 'side-instance-affects-singleton' }).ts, '2026-09-06T21:00:00.123+09:00');
    testing.resetLogging();
    const replacement = dispatcher.initializeLogging();
    assert.equal(replacement.validate({ event: 'reset-keeps-zone' }).ts, '2026-09-06T21:00:00.123+09:00');
  });
  await check('LOGGING-RESET-LIFETIME', async () => {
    let finish, flushes = 0, finished = false;
    const pending = new Promise(resolve => { finish = resolve; });
    dispatcher.getDispatcher().addTransport({ name: 'deferred', send() {}, flush() { flushes++; return pending.then(() => { finished = true; }); } });
    assert.equal(testing.resetLogging(), undefined);
    assert.equal(flushes, 1); assert.equal(finished, false);
    assert.equal(dispatcher.isLoggingInitialized(), false);
    finish(); await pending; await Promise.resolve(); assert.equal(finished, true);
  });
  await check('LOGGING-SAMPLING-STATE', () => {
    const logger = createLogger(), before = [], after = [];
    dispatcher.initializeLogging().addTransport({ name: 'before', send: e => before.push(e) });
    logger.sampled('budget', { count: 1 }, { maxPerMinute: 1 });
    testing.resetLogging();
    dispatcher.initializeLogging().addTransport({ name: 'after', send: e => after.push(e) });
    logger.sampled('budget', { count: 2 }, { maxPerMinute: 1 });
    assert.equal(before.length, 1); assert.equal(after.length, 0);
    clock += 60_000;
    logger.sampled('budget', { count: 3 }, { maxPerMinute: 1 });
    assert.deepEqual(after.map(e => e.event), ['budget.aggregated', 'budget']);
    assert.deepEqual(after[0].data, { sampledCount: 1, skippedCount: 1, window: '60s', aggregated: { count: 2 } });
    logger.child({ child: 'a' }).sampled('budget', {}, { maxPerMinute: 1 });
    logger.child({ child: 'b' }).sampled('budget', {}, { maxPerMinute: 1 });
    assert.equal(after.length, 4);
  });
  await check('LOGGING-FLUSH-FAILURES', async () => {
    const diagnostics = [], order = [];
    process.stderr.write = chunk => { diagnostics.push(String(chunk)); return true; };
    const d = new testing.LogDispatcher();
    d.addTransport({ name: 'rejected', send() {}, flush() { order.push('first'); return Promise.reject(new Error('synthetic-rejected')); } });
    d.addTransport({ name: 'resolved', send() {}, flush() { order.push('second'); return Promise.resolve(); } });
    await d.flush(); assert.deepEqual(order, ['first', 'second']);
    assert.ok(diagnostics.some(s => s.includes('synthetic-rejected')));
    const sync = new testing.LogDispatcher(); let later = false;
    sync.addTransport({ name: 'throwing', send() {}, flush() { throw new Error('synthetic-sync'); } });
    sync.addTransport({ name: 'later', send() {}, flush() { later = true; return Promise.resolve(); } });
    await assert.rejects(sync.flush(), /synthetic-sync/); assert.equal(later, false);
    const nonPromise = new testing.LogDispatcher();
    nonPromise.addTransport({ name: 'nonpromise', send() {}, flush() { return 1; } });
    await assert.rejects(nonPromise.flush(), TypeError);
    process.stderr.write = originalWrite;
  });
  await check('LOGGING-SEND-FAILURE', () => {
    const events = [], diagnostics = [];
    process.stderr.write = chunk => { diagnostics.push(String(chunk)); return true; };
    const d = new testing.LogDispatcher();
    d.addTransport({ name: 'throws', send() { throw new Error('synthetic-send'); } });
    d.addTransport({ name: 'continues', send: e => events.push(e) });
    d.dispatch({ event: 'still-delivered', level: 'info' });
    assert.deepEqual(d.getMetrics(), { sent: 1, dropped: 0, errors: 1 });
    assert.equal(events.length, 1); assert.ok(diagnostics.some(s => s.includes('synthetic-send')));
    process.stderr.write = originalWrite;
  });
  await check('LOGGING-MUTABLE-PRIORITY', () => {
    const d = new testing.LogDispatcher({ defaultLevel: 'warn' });
    assert.equal(d.isLevelEnabled('debug'), false);
    testing.LEVEL_PRIORITY.debug = 9;
    assert.equal(d.isLevelEnabled('debug'), true);
    assert.equal(privateDispatcher.LEVEL_PRIORITY.debug, 9);
    testing.LEVEL_PRIORITY.debug = priority;
  });
} finally {
  testing.LEVEL_PRIORITY.debug = priority;
  process.stderr.write = originalWrite;
  testing.resetLogging();
  globalThis.Date = RealDate;
}
assert.equal(ids.length, 12);
process.stdout.write(JSON.stringify({ passed: true, ids, count: ids.length }) + '\n');
