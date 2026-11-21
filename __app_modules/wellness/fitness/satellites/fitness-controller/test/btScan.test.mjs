import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { handleBtScanRequest, stopScanWindow, isScanWindowOpen } from '../src/btScan.mjs';
import { handleBtPairRequest, isPairingWindowOpen } from '../src/btPairing.mjs';

const SILENT = { info() {}, warn() {}, error() {} };

/** A helper child that prints `lines`, then stays open until kill() (or exits if `exitCode` is set). */
function fakeScanHelper(lines, { exitCode = null } = {}) {
  const spawned = [];
  const spawnHelper = (argJson) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;
    child.kill = () => {
      child.killed = true;
      setImmediate(() => {
        child.stdout.emit('data', Buffer.from(`${JSON.stringify({ phase: 'done', reason: 'stopped' })}\n`));
        child.emit('close', null, 'SIGTERM');
      });
      return true;
    };
    spawned.push({ args: JSON.parse(argJson), child });
    setImmediate(() => {
      child.stdout.emit('data', Buffer.from(lines.map((l) => JSON.stringify(l)).join('\n') + '\n'));
      if (exitCode !== null) child.emit('close', exitCode, null);
    });
    return child;
  };
  return { spawnHelper, spawned };
}

const tick = () => new Promise((r) => setImmediate(r));

beforeEach(async () => { await stopScanWindow(); });

test('start relays scanning and nearby with the requestId, and pauses reconnects', async () => {
  const sent = [];
  const windows = [];
  const h = fakeScanHelper([{ phase: 'scanning', durationMs: 60000 },
    { phase: 'nearby', devices: [{ address: 'AA:BB:CC:11:22:33', name: 'R1', hid: true }] }]);
  await handleBtScanRequest({ requestId: 's1', action: 'start', durationMs: 60000 },
    { spawnHelper: h.spawnHelper, send: (t, p) => sent.push([t, p]), logger: SILENT, onWindow: (o) => windows.push(o) });
  await tick(); await tick();
  assert.deepEqual(sent.map(([t, p]) => [t, p.requestId, p.phase]),
    [['bt.scan.progress', 's1', 'scanning'], ['bt.scan.progress', 's1', 'nearby']]);
  assert.equal(h.spawned[0].args.durationMs, 60000);
  assert.equal(isScanWindowOpen(), true);
  assert.deepEqual(windows, [true]);
  await stopScanWindow();
  assert.equal(sent.at(-1)[1].phase, 'done');
  assert.equal(sent.at(-1)[1].reason, 'stopped');
  assert.equal(isScanWindowOpen(), false);
  assert.deepEqual(windows, [true, false]);
});

test('stop action ends the running search', async () => {
  const sent = [];
  const h = fakeScanHelper([{ phase: 'scanning', durationMs: 60000 }]);
  await handleBtScanRequest({ requestId: 's2', action: 'start' }, { spawnHelper: h.spawnHelper, send: (t, p) => sent.push(p), logger: SILENT });
  await tick();
  await handleBtScanRequest({ requestId: 's2', action: 'stop' }, { spawnHelper: h.spawnHelper, send: (t, p) => sent.push(p), logger: SILENT });
  assert.equal(h.spawned[0].child.killed, true);
  assert.equal(sent.filter((p) => p.phase === 'done').length, 1);
});

test('a new start stops the old search first', async () => {
  const sent = [];
  const h = fakeScanHelper([{ phase: 'scanning', durationMs: 60000 }]);
  const deps = { spawnHelper: h.spawnHelper, send: (t, p) => sent.push(p), logger: SILENT };
  await handleBtScanRequest({ requestId: 'a', action: 'start' }, deps);
  await tick();
  await handleBtScanRequest({ requestId: 'b', action: 'start' }, deps);
  assert.equal(h.spawned[0].child.killed, true);
  assert.equal(h.spawned.length, 2);
  assert.deepEqual(sent.filter((p) => p.phase === 'done').map((p) => p.requestId), ['a']);
});

test('refused while a pairing window is open', async () => {
  const sent = [];
  const h = fakeScanHelper([]);
  await handleBtScanRequest({ requestId: 'c', action: 'start' },
    { spawnHelper: h.spawnHelper, send: (t, p) => sent.push([t, p]), logger: SILENT, isPairingOpen: () => true });
  assert.equal(h.spawned.length, 0);
  assert.deepEqual(sent, [['bt.scan.progress', { requestId: 'c', phase: 'done', reason: 'busy' }]]);
});

test('duration is clamped to 5 s .. 120 s', async () => {
  const h = fakeScanHelper([], { exitCode: 0 });
  await handleBtScanRequest({ requestId: 'd', action: 'start', durationMs: 999999 }, { spawnHelper: h.spawnHelper, send: () => {}, logger: SILENT });
  assert.equal(h.spawned[0].args.durationMs, 120000);
});

test('a helper that dies reports helper-crashed exactly once', async () => {
  const sent = [];
  const h = fakeScanHelper([{ phase: 'scanning', durationMs: 60000 }], { exitCode: 1 });
  await handleBtScanRequest({ requestId: 'e', action: 'start' }, { spawnHelper: h.spawnHelper, send: (t, p) => sent.push(p), logger: SILENT });
  await tick(); await tick();
  assert.deepEqual(sent.filter((p) => p.phase === 'done'), [{ requestId: 'e', phase: 'done', reason: 'helper-crashed' }]);
  assert.equal(isScanWindowOpen(), false);
});

test('two starts during one stop: only the newest spawns, no helper is orphaned', async () => {
  const h = fakeScanHelper([{ phase: 'scanning', durationMs: 60000 }]);
  const deps = { spawnHelper: h.spawnHelper, send: () => {}, logger: SILENT };
  await handleBtScanRequest({ requestId: 'a', action: 'start' }, deps);
  await tick();
  await Promise.all([
    handleBtScanRequest({ requestId: 'b', action: 'start' }, deps),
    handleBtScanRequest({ requestId: 'c', action: 'start' }, deps),
  ]);
  assert.equal(h.spawned.length, 2);
  assert.equal(h.spawned[0].child.killed, true);
  assert.equal(h.spawned[1].child.killed, false);
  assert.equal(isScanWindowOpen(), true);
});

test('a scan restart racing a pair request: the pair wins and never overlaps a search', async () => {
  const sent = [];
  const h = fakeScanHelper([{ phase: 'scanning', durationMs: 60000 }]);
  const scanDeps = { spawnHelper: h.spawnHelper, send: (t, p) => sent.push(p), logger: SILENT, isPairingOpen: isPairingWindowOpen };
  await handleBtScanRequest({ requestId: 'a', action: 'start' }, scanDeps);
  await tick();
  const scanOpenAtPairSpawn = [];
  const pairSpawn = () => {
    scanOpenAtPairSpawn.push(isScanWindowOpen());
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      child.stdout.emit('data', Buffer.from(`${JSON.stringify({ phase: 'done', paired: [] })}\n`));
      child.emit('close', 0);
    });
    return child;
  };
  await Promise.all([
    handleBtScanRequest({ requestId: 'b', action: 'start' }, scanDeps),
    handleBtPairRequest({ requestId: 'p', mode: 'address', address: 'AA:BB:CC:11:22:33' },
      { spawnHelper: pairSpawn, send: () => {}, logger: SILENT, stopScan: stopScanWindow }),
  ]);
  assert.equal(h.spawned.length, 1);
  assert.deepEqual(scanOpenAtPairSpawn, [false]);
  assert.deepEqual(sent.filter((p) => p.requestId === 'b'), [{ requestId: 'b', phase: 'done', reason: 'busy' }]);
});

test('stop for another search is ignored; stop for this one ends it', async () => {
  const h = fakeScanHelper([{ phase: 'scanning', durationMs: 60000 }]);
  const deps = { spawnHelper: h.spawnHelper, send: () => {}, logger: SILENT };
  await handleBtScanRequest({ requestId: 's7', action: 'start' }, deps);
  await tick();
  await handleBtScanRequest({ requestId: 'other', action: 'stop' }, deps);
  assert.equal(h.spawned[0].child.killed, false);
  await handleBtScanRequest({ requestId: 's7', action: 'stop' }, deps);
  assert.equal(h.spawned[0].child.killed, true);
});

test('a helper that ignores SIGTERM is killed and the stop still resolves', async () => {
  const sent = [];
  const signals = [];
  const spawnHelper = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = (sig) => { signals.push(sig); return true; }; // never closes
    return child;
  };
  await handleBtScanRequest({ requestId: 'k', action: 'start' }, { spawnHelper, send: (t, p) => sent.push(p), logger: SILENT });
  await stopScanWindow({ graceMs: 10 });
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(isScanWindowOpen(), false);
  assert.deepEqual(sent.filter((p) => p.phase === 'done').map((p) => p.reason), ['stopped']);
});
