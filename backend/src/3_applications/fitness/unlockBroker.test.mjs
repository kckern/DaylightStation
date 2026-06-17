// backend/src/3_applications/fitness/unlockBroker.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUnlockBroker } from './unlockBroker.mjs';

/**
 * Build a manual fake timer harness: setTimeoutFn records the callback so the
 * test can fire it deterministically; clearTimeoutFn marks it cancelled.
 */
function makeFakeTimers() {
  const timers = new Map();
  let nextHandle = 1;
  return {
    timers,
    setTimeoutFn(cb, ms) {
      const handle = nextHandle++;
      timers.set(handle, { cb, ms, cancelled: false });
      return handle;
    },
    clearTimeoutFn(handle) {
      const t = timers.get(handle);
      if (t) t.cancelled = true;
    },
    fire(handle) {
      const t = timers.get(handle);
      if (t && !t.cancelled) t.cb();
    },
  };
}

/** Resolves to true if the promise settles within a microtask flush, else false. */
function isSettled(promise) {
  let settled = false;
  promise.then(() => { settled = true; }, () => { settled = true; });
  return Promise.resolve().then(() => Promise.resolve()).then(() => settled);
}

test('requestUnlock publishes the request topic with a correlated payload', async () => {
  const published = [];
  const timers = makeFakeTimers();
  const broker = createUnlockBroker({
    publish: (topic, payload) => published.push({ topic, payload }),
    timeoutMs: 1000,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    idFn: () => 'req-1',
  });

  broker.requestUnlock({ lockName: 'lock-x', candidateUuids: ['uuid-a', 'uuid-b'] });

  assert.equal(published.length, 1);
  assert.equal(published[0].topic, 'fitness.unlock.request');
  assert.deepEqual(published[0].payload, {
    requestId: 'req-1',
    lockName: 'lock-x',
    candidateUuids: ['uuid-a', 'uuid-b'],
  });
});

test('resolveResult with matching requestId resolves to {matched:true,userId}', async () => {
  const timers = makeFakeTimers();
  const broker = createUnlockBroker({
    publish: () => {},
    timeoutMs: 1000,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    idFn: () => 'req-2',
  });

  const promise = broker.requestUnlock({ lockName: 'lock-x', candidateUuids: [] });
  broker.resolveResult({ requestId: 'req-2', matched: true, userId: 'test-user' });

  assert.deepEqual(await promise, { matched: true, userId: 'test-user' });
});

test('resolveResult with a non-matching requestId is ignored', async () => {
  const timers = makeFakeTimers();
  const broker = createUnlockBroker({
    publish: () => {},
    timeoutMs: 1000,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    idFn: () => 'req-3',
  });

  const promise = broker.requestUnlock({ lockName: 'lock-x', candidateUuids: [] });

  // No throw, and the pending promise stays pending.
  broker.resolveResult({ requestId: 'does-not-exist', matched: true, userId: 'nobody' });
  assert.equal(await isSettled(promise), false);

  // A subsequent matching resolve still works.
  broker.resolveResult({ requestId: 'req-3', matched: true, userId: 'test-user' });
  assert.deepEqual(await promise, { matched: true, userId: 'test-user' });
});

test('firing the injected timeout resolves to {matched:false, reason:timeout}', async () => {
  const timers = makeFakeTimers();
  const broker = createUnlockBroker({
    publish: () => {},
    timeoutMs: 1000,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    idFn: () => 'req-4',
  });

  const promise = broker.requestUnlock({ lockName: 'lock-x', candidateUuids: [] });

  // Exactly one timer should be registered; fire it.
  assert.equal(timers.timers.size, 1);
  const [handle] = [...timers.timers.keys()];
  timers.fire(handle);

  assert.deepEqual(await promise, { matched: false, reason: 'timeout' });
});
