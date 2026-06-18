import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReaderArbiter } from '../src/readerArbiter.mjs';

const silent = { log() {} };

// A controllable fake scan: resolves when you call its `finish`, or resolves
// { matched:false, reason:'aborted' } when its AbortSignal fires.
function deferredScan() {
  const calls = [];
  function runScan(uuids, { signal }) {
    return new Promise((resolve) => {
      const rec = { uuids, resolve, aborted: false };
      calls.push(rec);
      signal.addEventListener('abort', () => {
        rec.aborted = true;
        resolve({ matched: false, reason: 'aborted' });
      }, { once: true });
      rec.finish = (result) => resolve(result);
    });
  }
  return { runScan, calls };
}

test('runs a single scan and returns its result', async () => {
  const { runScan, calls } = deferredScan();
  const arb = createReaderArbiter({ runScan, logger: silent });
  const p = arb.submit({ kind: 'emergency', uuids: ['a'] });
  assert.equal(arb.currentKind(), 'emergency');
  calls[0].finish({ matched: true, uuid: 'a' });
  assert.deepEqual(await p, { matched: true, uuid: 'a' });
  assert.equal(arb.currentKind(), null);
});

test('foreground preempts an in-flight emergency scan', async () => {
  const { runScan, calls } = deferredScan();
  const arb = createReaderArbiter({ runScan, logger: silent });

  const emergency = arb.submit({ kind: 'emergency', uuids: ['admin'] });
  assert.equal(arb.currentKind(), 'emergency');

  // Foreground arrives — must abort the emergency scan and start its own.
  const foreground = arb.submit({ kind: 'foreground', uuids: ['dance'] });

  // The aborted emergency scan resolves reader-busy/aborted to its caller.
  const emResult = await emergency;
  assert.equal(emResult.matched, false);
  assert.equal(calls[0].aborted, true);

  // The foreground scan is now the in-flight one.
  assert.equal(arb.currentKind(), 'foreground');
  assert.equal(calls[1].uuids[0], 'dance');
  calls[1].finish({ matched: true, uuid: 'dance' });
  assert.deepEqual(await foreground, { matched: true, uuid: 'dance' });
});

test('emergency does NOT preempt a foreground scan (reader-busy)', async () => {
  const { runScan, calls } = deferredScan();
  const arb = createReaderArbiter({ runScan, logger: silent });

  const foreground = arb.submit({ kind: 'foreground', uuids: ['dance'] });
  const emergency = await arb.submit({ kind: 'emergency', uuids: ['admin'] });

  assert.deepEqual(emergency, { matched: false, reason: 'reader-busy' });
  assert.equal(calls.length, 1, 'emergency must not start a second scan');
  calls[0].finish({ matched: false, reason: 'no-match' });
  await foreground;
});

test('a second foreground while one is in flight is refused', async () => {
  const { runScan, calls } = deferredScan();
  const arb = createReaderArbiter({ runScan, logger: silent });
  const first = arb.submit({ kind: 'foreground', uuids: ['a'] });
  const second = await arb.submit({ kind: 'foreground', uuids: ['b'] });
  assert.deepEqual(second, { matched: false, reason: 'reader-busy' });
  assert.equal(calls.length, 1);
  calls[0].finish({ matched: false, reason: 'no-match' });
  await first;
});
