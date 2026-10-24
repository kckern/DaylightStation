import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  isLikelyGamepad,
  parseDiscovered,
  sanitizeTargets,
  parseHelperLine,
  runPairingWindow,
  handleBtPairRequest,
  handleBtRemoveRequest,
  isPairingWindowOpen,
} from "../src/btPairing.mjs";

// ── isLikelyGamepad ───────────────────────────────────────────────────────

test('isLikelyGamepad: Icon input-gaming → true', () => {
  const info = [
    'Device AA:BB:CC:DD:EE:FF (public)',
    '\tName: Some Pad',
    '\tIcon: input-gaming',
  ].join('\n');
  assert.equal(isLikelyGamepad(info), true);
});

test('isLikelyGamepad: 8BitDo name → true', () => {
  const info = '\tName: 8BitDo SN30 Pro\n\tIcon: input-keyboard';
  assert.equal(isLikelyGamepad(info), true);
});

test('isLikelyGamepad: Xbox / DualSense / Pro Controller names → true', () => {
  assert.equal(isLikelyGamepad('\tName: Xbox Wireless Controller'), true);
  assert.equal(isLikelyGamepad('\tName: DualSense Wireless Controller'), true);
  assert.equal(isLikelyGamepad('\tName: Pro Controller'), true);
  assert.equal(isLikelyGamepad('\tName: Joy-Con (L)'), true);
});

test('isLikelyGamepad: peripheral/gamepad major class → true', () => {
  // Class major device class = Peripheral (0x05), minor gamepad.
  const info = '\tName: Generic\n\tClass: 0x00002508';
  assert.equal(isLikelyGamepad(info), true);
});

test('isLikelyGamepad: HR strap → false', () => {
  const info = [
    'Device 11:22:33:44:55:66 (public)',
    '\tName: Polar H10',
    '\tIcon: heart-rate',
    '\tClass: 0x00000918',
  ].join('\n');
  assert.equal(isLikelyGamepad(info), false);
});

test('isLikelyGamepad: headphones → false', () => {
  const info = [
    '\tName: WH-1000XM4',
    '\tIcon: audio-headphones',
    '\tClass: 0x00240404',
  ].join('\n');
  assert.equal(isLikelyGamepad(info), false);
});

test('isLikelyGamepad: empty/nullish → false', () => {
  assert.equal(isLikelyGamepad(''), false);
  assert.equal(isLikelyGamepad(null), false);
  assert.equal(isLikelyGamepad(undefined), false);
});

// ── parseDiscovered ───────────────────────────────────────────────────────

test('parseDiscovered: parses bluetoothctl devices lines', () => {
  const out = [
    'Device AA:BB:CC:DD:EE:FF 8BitDo SN30 Pro',
    'Device 11:22:33:44:55:66 Polar H10',
  ].join('\n');
  assert.deepEqual(parseDiscovered(out), [
    { address: 'AA:BB:CC:DD:EE:FF', name: '8BitDo SN30 Pro' },
    { address: '11:22:33:44:55:66', name: 'Polar H10' },
  ]);
});

test('parseDiscovered: empty/nullish → []', () => {
  assert.deepEqual(parseDiscovered(''), []);
  assert.deepEqual(parseDiscovered(null), []);
});

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

const SFC30 = { address: 'E4:17:D8:C6:54:F0', name: '8Bitdo SFC30 GamePad' };
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
  // The helper got the sanitized targets (PIN included) and the window length.
  assert.deepEqual(args[0], { targets: TARGETS, durationMs: 60000 });
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

test('handleBtPairRequest: pauses the inventory for the window; a second request while open is ignored', async () => {
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
  assert.ok(calls.every((c) => c.payload.requestId === 'r1'));
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
  assert.equal(sent[0][1].error, 'not found');
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
