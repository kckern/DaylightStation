import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isLikelyGamepad,
  parseDiscovered,
  runPairingWindow,
  handleBtPairRequest,
} from '../src/btPairing.mjs';

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

// ── runPairingWindow ──────────────────────────────────────────────────────

function makeSendSpy() {
  const calls = [];
  const send = (topic, payload) => calls.push({ topic, payload });
  return { send, calls };
}

const SILENT_LOGGER = { log() {}, info() {}, warn() {}, error() {} };

test('runPairingWindow: happy path — one gamepad → scanning→paired→done with pair/trust/connect in order', async () => {
  const execCalls = [];
  const exec = async (cmd) => {
    execCalls.push(cmd);
    if (cmd.includes('scan on')) return { stdout: '', stderr: '' };
    if (cmd === 'bluetoothctl devices') {
      return { stdout: 'Device AA:BB:CC:DD:EE:FF 8BitDo SN30 Pro', stderr: '' };
    }
    if (cmd === 'bluetoothctl info AA:BB:CC:DD:EE:FF') {
      return { stdout: '\tName: 8BitDo SN30 Pro\n\tIcon: input-gaming', stderr: '' };
    }
    return { stdout: '', stderr: '' };
  };
  const { send, calls } = makeSendSpy();

  const paired = await runPairingWindow({ exec, durationMs: 4000, send, logger: SILENT_LOGGER });

  const phases = calls.map((c) => c.payload.phase);
  assert.deepEqual(phases, ['scanning', 'paired', 'done']);
  assert.deepEqual(calls[1].payload.device, {
    address: 'AA:BB:CC:DD:EE:FF',
    name: '8BitDo SN30 Pro',
  });
  assert.deepEqual(calls[2].payload.paired, [
    { address: 'AA:BB:CC:DD:EE:FF', name: '8BitDo SN30 Pro' },
  ]);
  assert.deepEqual(paired, [
    { address: 'AA:BB:CC:DD:EE:FF', name: '8BitDo SN30 Pro' },
  ]);

  // pair/trust/connect happened in order for the device.
  const pairIdx = execCalls.indexOf('bluetoothctl pair AA:BB:CC:DD:EE:FF');
  const trustIdx = execCalls.indexOf('bluetoothctl trust AA:BB:CC:DD:EE:FF');
  const connectIdx = execCalls.indexOf('bluetoothctl connect AA:BB:CC:DD:EE:FF');
  assert.ok(pairIdx >= 0 && trustIdx > pairIdx && connectIdx > trustIdx);

  // scan was one-shot with --timeout in seconds (4000ms → 4s).
  assert.ok(execCalls.some((c) => /bluetoothctl --timeout 4 scan on/.test(c)));
});

test('runPairingWindow: non-gamepad discovered is skipped (no pair attempt)', async () => {
  const execCalls = [];
  const exec = async (cmd) => {
    execCalls.push(cmd);
    if (cmd.includes('scan on')) return { stdout: '', stderr: '' };
    if (cmd === 'bluetoothctl devices') {
      return { stdout: 'Device 11:22:33:44:55:66 Polar H10', stderr: '' };
    }
    if (cmd === 'bluetoothctl info 11:22:33:44:55:66') {
      return { stdout: '\tName: Polar H10\n\tIcon: heart-rate', stderr: '' };
    }
    return { stdout: '', stderr: '' };
  };
  const { send, calls } = makeSendSpy();

  const paired = await runPairingWindow({ exec, durationMs: 5000, send, logger: SILENT_LOGGER });

  assert.deepEqual(paired, []);
  assert.deepEqual(calls.map((c) => c.payload.phase), ['scanning', 'done']);
  assert.ok(!execCalls.some((c) => c.startsWith('bluetoothctl pair')));
});

test('runPairingWindow: a pair failure emits error phase but still reaches done', async () => {
  const exec = async (cmd) => {
    if (cmd.includes('scan on')) return { stdout: '', stderr: '' };
    if (cmd === 'bluetoothctl devices') {
      return { stdout: 'Device AA:BB:CC:DD:EE:FF 8BitDo SN30 Pro', stderr: '' };
    }
    if (cmd === 'bluetoothctl info AA:BB:CC:DD:EE:FF') {
      return { stdout: '\tIcon: input-gaming', stderr: '' };
    }
    if (cmd === 'bluetoothctl pair AA:BB:CC:DD:EE:FF') {
      throw new Error('Failed to pair: org.bluez.Error.AuthenticationFailed');
    }
    return { stdout: '', stderr: '' };
  };
  const { send, calls } = makeSendSpy();

  const paired = await runPairingWindow({ exec, durationMs: 3000, send, logger: SILENT_LOGGER });

  const phases = calls.map((c) => c.payload.phase);
  assert.deepEqual(phases, ['scanning', 'error', 'done']);
  assert.equal(calls[1].payload.device.address, 'AA:BB:CC:DD:EE:FF');
  assert.match(calls[1].payload.message, /AuthenticationFailed/);
  assert.deepEqual(paired, []);
});

test('runPairingWindow: exec throwing entirely → single error progress + done, no throw', async () => {
  const exec = async () => { throw new Error('command not found: bluetoothctl'); };
  const { send, calls } = makeSendSpy();

  const paired = await runPairingWindow({ exec, durationMs: 3000, send, logger: SILENT_LOGGER });

  const phases = calls.map((c) => c.payload.phase);
  // scanning emitted first, then the scan/devices exec blows up → error, then done.
  assert.deepEqual(phases, ['scanning', 'error', 'done']);
  assert.deepEqual(paired, []);
});

test('runPairingWindow: passes requestId through to progress events', async () => {
  const exec = async (cmd) => {
    if (cmd.includes('scan on')) return { stdout: '', stderr: '' };
    if (cmd === 'bluetoothctl devices') return { stdout: '', stderr: '' };
    return { stdout: '', stderr: '' };
  };
  const { send, calls } = makeSendSpy();
  await runPairingWindow({ exec, durationMs: 2000, send, logger: SILENT_LOGGER, requestId: 'req-7' });
  assert.ok(calls.every((c) => c.payload.requestId === 'req-7'));
});

// ── handleBtPairRequest ───────────────────────────────────────────────────

test('handleBtPairRequest: runs a pairing window from the message durationMs', async () => {
  const exec = async (cmd) => {
    if (cmd === 'bluetoothctl devices') return { stdout: '', stderr: '' };
    return { stdout: '', stderr: '' };
  };
  const { send, calls } = makeSendSpy();
  await handleBtPairRequest(
    { topic: 'bt.pair.request', requestId: 'r1', durationMs: 8000 },
    { exec, send, logger: SILENT_LOGGER }
  );
  assert.equal(calls[0].payload.phase, 'scanning');
  assert.equal(calls[0].payload.durationMs, 8000);
  assert.equal(calls[0].payload.requestId, 'r1');
  assert.equal(calls.at(-1).payload.phase, 'done');
});
