// backend/src/3_applications/fitness/manageBroker.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createManageBroker } from './manageBroker.mjs';

function fakeTimers() {
  const timers = new Map(); let seq = 0;
  return {
    setTimeoutFn: (cb, ms) => { const id = ++seq; timers.set(id, cb); return id; },
    clearTimeoutFn: (id) => timers.delete(id),
    fire: (id) => { const cb = timers.get(id); timers.delete(id); cb?.(); },
  };
}

test('requestEnroll publishes a request and resolves on result', async () => {
  const published = [];
  let n = 0;
  const broker = createManageBroker({
    publish: (t, p) => published.push({ t, p }),
    idFn: () => `req-${++n}`,
  });
  const promise = broker.requestEnroll({ finger: 'right-index', username: 'test-user' });
  assert.deepEqual(published[0], { t: 'fitness.enroll.request', p: { requestId: 'req-1', finger: 'right-index', username: 'test-user' } });
  broker.resolveEnrollResult({ requestId: 'req-1', success: true, uuid: 'new-uuid' });
  assert.deepEqual(await promise, { success: true, uuid: 'new-uuid' });
});

test('enroll progress invokes the onProgress callback for the matching request', async () => {
  const seen = [];
  let n = 0;
  const broker = createManageBroker({ publish: () => {}, idFn: () => `req-${++n}` });
  const promise = broker.requestEnroll({ finger: 'right-index', username: 'test-user', onProgress: (p) => seen.push(p) });
  broker.handleEnrollProgress({ requestId: 'req-1', stage: 2, stagesTotal: 5 });
  broker.handleEnrollProgress({ requestId: 'nope', stage: 9, stagesTotal: 5 }); // ignored
  broker.resolveEnrollResult({ requestId: 'req-1', success: true, uuid: 'u' });
  await promise;
  assert.deepEqual(seen, [{ stage: 2, stagesTotal: 5 }]);
});

test('enroll times out to {success:false, error:"timeout"}', async () => {
  const timers = fakeTimers();
  let n = 0;
  const broker = createManageBroker({
    publish: () => {}, idFn: () => `req-${++n}`,
    setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn,
  });
  const promise = broker.requestEnroll({ finger: 'right-index', username: 'test-user' });
  timers.fire(1);
  assert.deepEqual(await promise, { success: false, error: 'timeout' });
});

test('requestDelete publishes and resolves on result', async () => {
  const published = [];
  let n = 0;
  const broker = createManageBroker({ publish: (t, p) => published.push({ t, p }), idFn: () => `req-${++n}` });
  const promise = broker.requestDelete({ uuid: 'u1' });
  assert.deepEqual(published[0], { t: 'fitness.fingerprint.delete.request', p: { requestId: 'req-1', uuid: 'u1' } });
  broker.resolveDeleteResult({ requestId: 'req-1', success: true });
  assert.deepEqual(await promise, { success: true });
});
