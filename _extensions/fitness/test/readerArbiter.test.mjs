import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReaderArbiter } from '../src/readerArbiter.mjs';

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('runs work when idle and returns {ok:true, value}', async () => {
  const arb = createReaderArbiter({ logger: { log() {} } });
  const r = await arb.run({ kind: 'scan', preempts: [], exec: async () => ({ matched: false }) });
  assert.deepEqual(r, { ok: true, value: { matched: false } });
  assert.equal(arb.currentKind(), null);
});

test('refuses a non-preempting kind while busy', async () => {
  const arb = createReaderArbiter({ logger: { log() {} } });
  const d = deferred();
  const running = arb.run({ kind: 'scan', preempts: [], exec: () => d.promise });
  const refused = await arb.run({ kind: 'scan', preempts: [], exec: async () => ({ matched: true }) });
  assert.deepEqual(refused, { ok: false, reason: 'reader-busy' });
  d.resolve({ matched: false });
  await running;
});

test('a preempting kind cancels the in-flight work via signal and then runs', async () => {
  const arb = createReaderArbiter({ logger: { log() {} } });
  let scanAborted = false;
  const scanStarted = deferred();
  const running = arb.run({
    kind: 'scan', preempts: [],
    exec: ({ signal }) => {
      scanStarted.resolve();
      return new Promise((resolve) => {
        signal.addEventListener('abort', () => { scanAborted = true; resolve({ matched: false, reason: 'cancelled' }); });
      });
    },
  });
  await scanStarted.promise;
  const r = await arb.run({ kind: 'enroll', preempts: ['scan'], exec: async () => ({ enrolled: true }) });
  assert.equal(scanAborted, true);
  assert.deepEqual(r, { ok: true, value: { enrolled: true } });
  await running;
  assert.equal(arb.currentKind(), null);
});

test('currentKind reflects the in-flight kind', async () => {
  const arb = createReaderArbiter({ logger: { log() {} } });
  const d = deferred();
  const running = arb.run({ kind: 'manage', preempts: ['scan'], exec: () => d.promise });
  assert.equal(arb.currentKind(), 'manage');
  d.resolve({ matched: true });
  await running;
  assert.equal(arb.currentKind(), null);
});
