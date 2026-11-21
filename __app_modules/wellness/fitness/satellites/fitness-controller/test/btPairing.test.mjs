import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  sanitizeTargets,
  parseHelperLine,
  runPairingWindow,
  handleBtPairRequest,
  handleBtRemoveRequest,
  isPairingWindowOpen,
} from "../src/btPairing.mjs";

// ── targets + helper output ───────────────────────────────────────────────

test('sanitizeTargets: keeps name/macPrefix/pin, drops bad regex, bad prefix and empty targets', () => {
  assert.deepEqual(sanitizeTargets([
    { id: 'sfc30', label: '8BitDo SF30', name: '8bitdo|sfc30', macPrefix: 'e4:17:d8', pin: '0000' },
    { id: 'bad', name: '(' , macPrefix: 'zz' },
    { id: 'pinonly', pin: '1234' },
    null,
  ]), [{ id: 'sfc30', label: '8BitDo SF30', name: '8bitdo|sfc30', macPrefix: 'E4:17:D8', pin: '0000' }]);
  assert.deepEqual(sanitizeTargets([{ id: 'x', name: 'Xbox', pin: '00;rm -rf' }]), [{ id: 'x', label: null, name: 'Xbox' }]);
});

test('parseHelperLine: JSON phase lines only', () => {
  assert.deepEqual(parseHelperLine('{"phase":"seen","device":{"address":"A"}}'), { phase: 'seen', device: { address: 'A' } });
  assert.equal(parseHelperLine('Traceback (most recent call last):'), null);
  assert.equal(parseHelperLine('{"nophase":1}'), null);
});

// ── runPairingWindow ──────────────────────────────────────────────────────

function makeSendSpy() {
  const calls = [];
  const send = (topic, payload) => calls.push({ topic, payload });
  return { send, calls };
}

const SILENT_LOGGER = { log() {}, info() {}, warn() {}, error() {} };

/** A fake helper child that prints `lines` (split across chunks) then exits with `code`. */
function fakeHelper(lines, { code = 0, error = null } = {}) {
  const args = [];
  const spawnHelper = (argJson) => {
    args.push(JSON.parse(argJson));
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      if (error) { child.emit('error', error); return; }
      const text = lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n';
      // Split mid-line to prove the reader buffers partial lines.
      const mid = Math.floor(text.length / 2);
      child.stdout.emit('data', Buffer.from(text.slice(0, mid)));
      child.stdout.emit('data', Buffer.from(text.slice(mid)));
      child.emit('close', code);
    });
    return child;
  };
  return { spawnHelper, args };
}

const SFC30 = { address: 'E4:17:D8:00:00:10', name: '8Bitdo SFC30 GamePad' };
const TARGETS = [{ id: '8bitdo_sfc30', label: '8BitDo SF30', name: '8bitdo|sfc30', macPrefix: 'E4:17:D8', pin: '0000' }];

test('runPairingWindow: the full lifecycle is relayed in order with the requestId, ending in one done', async () => {
  const { spawnHelper, args } = fakeHelper([
    { phase: 'scanning', durationMs: 60000 },
    { phase: 'seen', device: SFC30 },
    { phase: 'found', device: SFC30, controllerId: '8bitdo_sfc30' },
    { phase: 'pairing', device: SFC30, controllerId: '8bitdo_sfc30', attempt: 1, pinConfigured: true },
    { phase: 'agent', request: 'pin' },
    { phase: 'bonded', device: SFC30, trusted: true },
    { phase: 'connecting', device: SFC30, attempt: 1 },
    { phase: 'hid-wait', device: SFC30, seconds: 15 },
    { phase: 'hid-retry', device: SFC30 },
    { phase: 'connecting', device: SFC30, attempt: 2 },
    { phase: 'hid-wait', device: SFC30, seconds: 15 },
    { phase: 'paired', device: SFC30, connected: true, input: true },
    { phase: 'done', paired: [SFC30] },
  ]);
  const { send, calls } = makeSendSpy();
  const paired = await runPairingWindow({ spawnHelper, durationMs: 60000, targets: TARGETS, send, logger: SILENT_LOGGER, requestId: 'pair-9' });

  assert.deepEqual(paired, [SFC30]);
  assert.deepEqual(calls.map((c) => c.payload.phase), [
    'scanning', 'seen', 'found', 'pairing', 'agent', 'bonded', 'connecting', 'hid-wait',
    'hid-retry', 'connecting', 'hid-wait', 'paired', 'done',
  ]);
  assert.ok(calls.every((c) => c.topic === 'bt.pair.progress' && c.payload.requestId === 'pair-9'));
  assert.equal(calls.filter((c) => c.payload.phase === 'done').length, 1);
  // The helper got the sanitized targets (PIN included), the window length and the mode.
  assert.deepEqual(args[0], { targets: TARGETS, durationMs: 60000, mode: 'repair' });
});

test('runPairingWindow: nothing seen → done reason none-found is passed through', async () => {
  const { spawnHelper } = fakeHelper([{ phase: 'scanning' }, { phase: 'done', paired: [], reason: 'none-found' }], { code: 1 });
  const { send, calls } = makeSendSpy();
  const paired = await runPairingWindow({ spawnHelper, send, logger: SILENT_LOGGER });
  assert.deepEqual(paired, []);
  assert.equal(calls.at(-1).payload.reason, 'none-found');
});

test('runPairingWindow: retry after an auth failure, then a final error, is relayed', async () => {
  const { spawnHelper } = fakeHelper([
    { phase: 'scanning' },
    { phase: 'pairing', device: SFC30, attempt: 1 },
    { phase: 'retry', device: SFC30, message: 'org.bluez.Error.AuthenticationFailed', attempt: 1 },
    { phase: 'pairing', device: SFC30, attempt: 2 },
    { phase: 'error', device: SFC30, message: 'org.bluez.Error.AuthenticationFailed' },
    { phase: 'done', paired: [], reason: 'pair-failed' },
  ], { code: 1 });
  const { send, calls } = makeSendSpy();
  await runPairingWindow({ spawnHelper, send, logger: SILENT_LOGGER });
  assert.deepEqual(calls.map((c) => c.payload.phase), ['scanning', 'pairing', 'retry', 'pairing', 'error', 'done']);
  assert.equal(calls.at(-1).payload.reason, 'pair-failed');
});

test('runPairingWindow: helper exits without a done → error + done helper-crashed (UI never hangs)', async () => {
  const { spawnHelper } = fakeHelper([{ phase: 'scanning' }, 'Traceback (most recent call last):'], { code: 1 });
  const { send, calls } = makeSendSpy();
  const paired = await runPairingWindow({ spawnHelper, send, logger: SILENT_LOGGER });
  assert.deepEqual(paired, []);
  assert.deepEqual(calls.map((c) => c.payload.phase), ['scanning', 'error', 'done']);
  assert.equal(calls.at(-1).payload.reason, 'helper-crashed');
});

test('runPairingWindow: helper fails to spawn → scanning, error, done', async () => {
  const { spawnHelper } = fakeHelper([], { error: new Error('spawn python3 ENOENT') });
  const { send, calls } = makeSendSpy();
  await runPairingWindow({ spawnHelper, send, logger: SILENT_LOGGER });
  assert.deepEqual(calls.map((c) => c.payload.phase), ['scanning', 'error', 'done']);
  assert.equal(calls.at(-1).payload.reason, 'helper-failed');
});

// ── handleBtPairRequest ───────────────────────────────────────────────────

test('handleBtPairRequest: pauses the inventory for the window; a second request while open is answered busy', async () => {
  const { spawnHelper, args } = fakeHelper([{ phase: 'scanning' }, { phase: 'done', paired: [] }]);
  const { send, calls } = makeSendSpy();
  const windows = [];
  const deps = { spawnHelper, send, logger: SILENT_LOGGER, onWindow: (open) => windows.push(open) };
  const first = handleBtPairRequest({ topic: 'bt.pair.request', requestId: 'r1', durationMs: 60000, targets: TARGETS }, deps);
  assert.equal(isPairingWindowOpen(), true);
  const second = await handleBtPairRequest({ topic: 'bt.pair.request', requestId: 'r2' }, deps);
  await first;
  assert.deepEqual(second, []);
  assert.equal(args.length, 1);
  assert.deepEqual(windows, [true, false]);
  assert.equal(isPairingWindowOpen(), false);
  const r2 = calls.filter((c) => c.payload.requestId === 'r2').map((c) => c.payload);
  assert.deepEqual(r2, [{ requestId: 'r2', phase: 'done', paired: [], reason: 'busy' }]);
  assert.ok(calls.filter((c) => c.payload.requestId !== 'r2').every((c) => c.payload.requestId === 'r1'));
});

test('handleBtPairRequest: a repeat of the open window\'s own request is ignored', async () => {
  const { spawnHelper, args } = fakeHelper([{ phase: 'scanning' }, { phase: 'done', paired: [] }]);
  const { send, calls } = makeSendSpy();
  const deps = { spawnHelper, send, logger: SILENT_LOGGER };
  const first = handleBtPairRequest({ requestId: 'r1', targets: TARGETS }, deps);
  await handleBtPairRequest({ requestId: 'r1', targets: TARGETS }, deps);
  await first;
  assert.equal(args.length, 1);
  assert.equal(calls.filter((c) => c.payload.phase === 'done').length, 1);
});

test('runPairingWindow: the fallback scanning event carries the mode', async () => {
  const spawnHelper = () => { throw new Error('ENOENT'); };
  const { send, calls } = makeSendSpy();
  await runPairingWindow({ spawnHelper, send, logger: SILENT_LOGGER, mode: 'address', targets: [] });
  assert.equal(calls[0].payload.phase, 'scanning');
  assert.equal(calls[0].payload.mode, 'address');
});

test('handleBtPairRequest: clamps durationMs to 5s–180s', async () => {
  const { spawnHelper, args } = fakeHelper([{ phase: 'done', paired: [] }]);
  await handleBtPairRequest({ requestId: 'r3', durationMs: 999999 }, { spawnHelper, send: () => {}, logger: SILENT_LOGGER });
  assert.equal(args[0].durationMs, 180000);
});

// ── handleBtRemoveRequest ─────────────────────────────────────────────────

test('handleBtRemoveRequest: removes a device and emits bt.remove.result success', async () => {
  const calls = [];
  const sent = [];
  const exec = async (cmd) => { calls.push(cmd); return { stdout: '', stderr: '' }; };
  await handleBtRemoveRequest(
    { requestId: 'r1', address: 'AA:BB:CC:DD:EE:FF' },
    { exec, send: (t, p) => sent.push([t, p]), logger: SILENT_LOGGER }
  );
  assert.ok(calls.includes('bluetoothctl --agent off remove AA:BB:CC:DD:EE:FF'));
  assert.deepEqual(sent, [
    ['bt.remove.result', { requestId: 'r1', address: 'AA:BB:CC:DD:EE:FF', success: true }],
  ]);
});

test('handleBtRemoveRequest: emits failure on exec error', async () => {
  const sent = [];
  const exec = async () => { throw new Error('not found'); };
  await handleBtRemoveRequest(
    { requestId: 'r2', address: 'AA:BB:CC:DD:EE:FF' },
    { exec, send: (t, p) => sent.push([t, p]), logger: SILENT_LOGGER }
  );
  assert.equal(sent[0][0], 'bt.remove.result');
  assert.equal(sent[0][1].success, false);
  assert.equal(sent[0][1].error, 'remove-failed');
});

test('handleBtRemoveRequest: refuses while a pairing window is open', async () => {
  const { spawnHelper } = fakeHelper([{ phase: 'scanning' }, { phase: 'done', paired: [] }]);
  const window = handleBtPairRequest({ topic: 'bt.pair.request', requestId: 'p1', durationMs: 60000, targets: TARGETS },
    { spawnHelper, send: () => {}, logger: SILENT_LOGGER });
  assert.equal(isPairingWindowOpen(), true);
  const calls = [];
  const sent = [];
  const warns = [];
  await handleBtRemoveRequest(
    { requestId: 'r9', address: 'AA:BB:CC:DD:EE:FF' },
    { exec: async (cmd) => { calls.push(cmd); return { stdout: '' }; }, send: (t, p) => sent.push([t, p]),
      logger: { ...SILENT_LOGGER, warn: (m) => warns.push(m) } },
  );
  await window;
  assert.deepEqual(calls, []);
  assert.deepEqual(sent, [
    ['bt.remove.result', { requestId: 'r9', address: 'AA:BB:CC:DD:EE:FF', success: false, error: 'pairing-in-progress' }],
  ]);
  assert.equal(warns.length, 1);
});

test('handleBtRemoveRequest: rejects a malformed MAC without shelling out', async () => {
  const calls = [];
  const sent = [];
  await handleBtRemoveRequest(
    { requestId: 'r3', address: 'nope' },
    { exec: async (c) => { calls.push(c); return { stdout: '' }; }, send: (t, p) => sent.push([t, p]) }
  );
  assert.equal(calls.length, 0);
  assert.equal(sent[0][1].success, false);
});

test('runPairingWindow: passes mode to the helper (default repair)', async () => {
  const a = fakeHelper([{ phase: 'scanning' }, { phase: 'done', paired: [] }]);
  await runPairingWindow({ spawnHelper: a.spawnHelper, send: () => {}, logger: SILENT_LOGGER });
  assert.equal(a.args[0].mode, 'repair');
  const b = fakeHelper([{ phase: 'scanning' }, { phase: 'done', paired: [] }]);
  await runPairingWindow({ spawnHelper: b.spawnHelper, send: () => {}, logger: SILENT_LOGGER, mode: 'address' });
  assert.equal(b.args[0].mode, 'address');
});

test('handleBtPairRequest: address mode sends one exact-address target, with the PIN', async () => {
  const a = fakeHelper([{ phase: 'scanning', mode: 'address' }, { phase: 'done', paired: [] }]);
  await handleBtPairRequest(
    { requestId: 'a1', mode: 'address', address: 'aa:bb:cc:11:22:33', targets: [{ id: 'pad', label: 'Pad', pin: '1234', name: '.*' }] },
    { spawnHelper: a.spawnHelper, send: () => {}, logger: SILENT_LOGGER },
  );
  assert.equal(a.args[0].mode, 'address');
  assert.deepEqual(a.args[0].targets, [{ id: 'pad', label: 'Pad', address: 'AA:BB:CC:11:22:33', pin: '1234' }]);
});

test('handleBtPairRequest: address mode with a malformed address never spawns', async () => {
  const a = fakeHelper([]);
  const { send, calls } = makeSendSpy();
  await handleBtPairRequest({ requestId: 'a2', mode: 'address', address: 'AA:BB; rm -rf /' }, { spawnHelper: a.spawnHelper, send, logger: SILENT_LOGGER });
  assert.equal(a.args.length, 0);
  assert.deepEqual(calls, [{ topic: 'bt.pair.progress', payload: { requestId: 'a2', phase: 'done', paired: [], reason: 'invalid-address' } }]);
});

test('handleBtPairRequest: the retired add mode and unknown modes are refused', async () => {
  for (const mode of ['add', 'rm -rf']) {
    const a = fakeHelper([]);
    const { send, calls } = makeSendSpy();
    await handleBtPairRequest({ requestId: 'm', mode }, { spawnHelper: a.spawnHelper, send, logger: SILENT_LOGGER });
    assert.equal(a.args.length, 0, mode);
    assert.equal(calls[0].payload.reason, 'unsupported-mode', mode);
  }
  // No mode at all is repair (the backend route sends none).
  const b = fakeHelper([{ phase: 'scanning' }, { phase: 'done', paired: [] }]);
  await handleBtPairRequest({ requestId: 'n' }, { spawnHelper: b.spawnHelper, send: () => {}, logger: SILENT_LOGGER });
  assert.equal(b.args[0].mode, 'repair');
});

test('handleBtPairRequest: a running search is stopped before the window opens', async () => {
  const order = [];
  const a = fakeHelper([{ phase: 'scanning', mode: 'address' }, { phase: 'done', paired: [] }]);
  await handleBtPairRequest(
    { requestId: 'a3', mode: 'address', address: 'AA:BB:CC:11:22:33' },
    {
      spawnHelper: (j) => { order.push('spawn'); return a.spawnHelper(j); },
      stopScan: async () => { order.push('stop-scan'); },
      onWindow: (open) => order.push(open ? 'pause' : 'resume'),
      send: () => {}, logger: SILENT_LOGGER,
    },
  );
  assert.deepEqual(order, ['stop-scan', 'pause', 'spawn', 'resume']);
});

test('handleBtRemoveRequest: a failed remove reports a code, not the shell text', async () => {
  const sent = [];
  await handleBtRemoveRequest(
    { requestId: 'r9', address: 'AA:BB:CC:11:22:33' },
    { exec: async () => { throw new Error('Command failed: bluetoothctl --agent off remove AA:BB:CC:11:22:33'); }, send: (t, p) => sent.push(p), logger: SILENT_LOGGER },
  );
  assert.deepEqual(sent, [{ requestId: 'r9', address: 'AA:BB:CC:11:22:33', success: false, error: 'remove-failed' }]);
});
