import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperationRegistry } from '../src/operationRegistry.mjs';
import { createBrowserPool } from '../src/browserPool.mjs';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const turn = () => new Promise(resolve => setImmediate(resolve));

test('exact registry refuses arbitrary browser operations and inherited names', async () => {
  const registry = createOperationRegistry([{ name: 'fixture.inspect', validate: value => value, execute: async value => value }]);
  assert.deepEqual(await registry.dispatch('fixture.inspect', { id: 'one' }), { id: 'one' });
  for (const name of ['browse', 'evaluate', 'fetch', 'proxy', 'constructor', 'fixture.inspect/']) {
    await assert.rejects(registry.dispatch(name, {}), { code: 'BROWSER_OPERATION_UNKNOWN' });
  }
});

test('single operation slot rejects overlap and creates a fresh context after release', async () => {
  let release;
  let contexts = 0;
  let closes = 0;
  const pool = createBrowserPool({ launch: async () => ({ newContext: async options => {
    assert.equal(options.acceptDownloads, false);
    assert.equal(options.serviceWorkers, 'block');
    contexts++;
    return { close: async () => { closes++; } };
  }, close: async () => {} }) });
  const first = pool.run(async () => new Promise(resolve => { release = resolve; }));
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(pool.run(async () => {}), { code: 'BROWSER_BUSY' });
  release('first');
  assert.equal(await first, 'first');
  assert.equal(await pool.run(async () => 'second'), 'second');
  assert.equal(contexts, 2);
  assert.equal(closes, 2);
  await pool.close();
});

test('hard deadline closes context, poisons an abort-ignoring worker, and sanitizes browser failure', async () => {
  let closes = 0;
  const pool = createBrowserPool({ timeoutMs: 15, launch: async () => ({ newContext: async () => ({ close: async () => { closes++; } }), close: async () => {} }) });
  await assert.rejects(pool.run(() => new Promise(() => {})), { code: 'BROWSER_TIMEOUT' });
  assert.equal(closes, 1);
  await assert.rejects(pool.run(() => { throw new Error('secret upstream URL'); }), error => error.code === 'BROWSER_FAILED' && !error.message.includes('secret'));
  assert.equal(closes, 1);
  await pool.close();
});

test('hard deadline aborts operation-owned work before another operation may start', async () => {
  const aborted = deferred();
  const settled = deferred();
  let activeExternalWork = 0;
  let overlap = false;
  const pool = createBrowserPool({ timeoutMs: 15, cleanupTimeoutMs: 100, launch: async () => ({
    newContext: async () => ({ close: async () => {} }), close: async () => {},
  }) });

  const first = pool.run(async (_context, { signal }) => {
    activeExternalWork += 1;
    await new Promise(resolve => signal.addEventListener('abort', () => {
      aborted.resolve();
      setImmediate(() => { activeExternalWork -= 1; settled.resolve(); resolve(); });
    }, { once: true }));
  });
  const firstRejected = assert.rejects(first, { code: 'BROWSER_TIMEOUT' });
  await aborted.promise;
  const second = pool.run(async () => {
    if (activeExternalWork) overlap = true;
    return 'second';
  }).catch(error => error.code);
  await firstRejected;
  await settled.promise;
  assert.equal(overlap, false);
  assert.ok(['BROWSER_BUSY', 'second'].includes(await second));
  if (await second === 'BROWSER_BUSY') assert.equal(await pool.run(async () => 'after-cleanup'), 'after-cleanup');
  await pool.close();
});

test('caller cancellation is combined into the operation-owned signal', async () => {
  const observed = deferred();
  const started = deferred();
  const caller = new AbortController();
  const pool = createBrowserPool({ launch: async () => ({
    newContext: async () => ({ close: async () => {} }), close: async () => {},
  }) });
  const pending = pool.run(async (_context, { signal }) => {
    assert.notEqual(signal, caller.signal);
    started.resolve();
    await new Promise(resolve => signal.addEventListener('abort', () => { observed.resolve(); resolve(); }, { once: true }));
  }, { signal: caller.signal });
  const rejected = assert.rejects(pending, { code: 'BROWSER_CANCELLED' });
  await started.promise;
  caller.abort();
  await observed.promise;
  await rejected;
  await pool.close();
});

test('disconnect cancels the operation and a late context cannot escape cleanup', async () => {
  let create;
  let closes = 0;
  const pool = createBrowserPool({ launch: async () => ({ newContext: () => new Promise(resolve => { create = resolve; }), close: async () => {} }) });
  const controller = new AbortController();
  const pending = pool.run(() => assert.fail('aborted operation executed'), { signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending, { code: 'BROWSER_CANCELLED' });
  create({ close: async () => { closes++; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closes, 1);
  await pool.close();
});

test('a hung context close cannot defeat the hard deadline and poisons the pool', async () => {
  let browserCloses = 0;
  const pool = createBrowserPool({ timeoutMs: 10, cleanupTimeoutMs: 10, launch: async () => ({
    newContext: async () => ({ close: () => new Promise(() => {}) }), close: async () => { browserCloses++; },
  }) });
  const outcome = await Promise.race([
    pool.run(() => new Promise(() => {})).catch(error => error.code),
    new Promise(resolve => setTimeout(() => resolve('HUNG'), 100)),
  ]);
  assert.equal(outcome, 'BROWSER_TIMEOUT');
  assert.equal(browserCloses, 1);
  await assert.rejects(pool.run(async () => 'unsafe reuse'), { code: 'BROWSER_FAILED' });
  await pool.close();
});

test('cancelled context acquisition never admits a second acquisition before late cleanup', async () => {
  const acquisition = deferred();
  const started = deferred();
  const contextClosing = deferred();
  const finishClose = deferred();
  let acquisitions = 0;
  let contextCloses = 0;
  const pool = createBrowserPool({ cleanupTimeoutMs: 10, launch: async () => ({
    newContext: () => { acquisitions++; started.resolve(); return acquisition.promise; },
    close: async () => {},
  }) });
  const controller = new AbortController();
  const pending = pool.run(() => assert.fail('cancelled handler ran'), { signal: controller.signal }).catch(error => error.code);
  await started.promise;
  controller.abort();
  await turn();
  const second = pool.run(() => assert.fail('overlapping handler ran')).catch(error => error.code);
  await turn();
  assert.equal(acquisitions, 1);
  acquisition.resolve({ close: async () => { contextCloses++; contextClosing.resolve(); await finishClose.promise; } });
  await contextClosing.promise;
  assert.equal(contextCloses, 1);
  await assert.rejects(pool.run(async () => {}), error => ['BROWSER_BUSY', 'BROWSER_FAILED'].includes(error.code));
  finishClose.resolve();
  assert.equal(await pending, 'BROWSER_CANCELLED');
  assert.ok(['BROWSER_BUSY', 'BROWSER_FAILED'].includes(await second));
  await pool.close();
});

test('pool close is bounded during a hung launch and a late browser is closed once', async () => {
  const launch = deferred();
  const started = deferred();
  let browserCloses = 0;
  let acquisitions = 0;
  const pool = createBrowserPool({ cleanupTimeoutMs: 10, launch: () => { started.resolve(); return launch.promise; } });
  const pending = pool.run(() => assert.fail('stopped handler ran')).catch(error => error.code);
  await started.promise;
  const closed = pool.close();
  assert.equal(await Promise.race([closed.then(() => 'closed'), new Promise(resolve => setTimeout(() => resolve('HUNG'), 200))]), 'closed');
  await assert.rejects(pool.run(async () => {}), { code: 'BROWSER_FAILED' });
  launch.resolve({ newContext: async () => { acquisitions++; return {}; }, close: async () => { browserCloses++; } });
  await turn();
  assert.equal(acquisitions, 0);
  assert.equal(browserCloses, 1);
  assert.equal(await pending, 'BROWSER_CANCELLED');
});
