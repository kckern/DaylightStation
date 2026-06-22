import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseConnectedDevices,
  parseBattery,
  pollBtInventory,
} from '../src/btInventory.mjs';

// ── parseConnectedDevices ─────────────────────────────────────────────────

test('parseConnectedDevices: parses well-formed Device lines', () => {
  const out = [
    'Device AA:BB:CC:DD:EE:FF 8BitDo SN30 Pro',
    'Device 11:22:33:44:55:66 Xbox Wireless Controller',
  ].join('\n');
  assert.deepEqual(parseConnectedDevices(out), [
    { address: 'AA:BB:CC:DD:EE:FF', name: '8BitDo SN30 Pro' },
    { address: '11:22:33:44:55:66', name: 'Xbox Wireless Controller' },
  ]);
});

test('parseConnectedDevices: tolerates blank and malformed lines', () => {
  const out = [
    '',
    'Device AA:BB:CC:DD:EE:FF Good Name',
    'garbage line',
    '   ',
    'Device NOTAMAC also bad',
  ].join('\n');
  assert.deepEqual(parseConnectedDevices(out), [
    { address: 'AA:BB:CC:DD:EE:FF', name: 'Good Name' },
  ]);
});

test('parseConnectedDevices: device with no name yields empty name', () => {
  assert.deepEqual(parseConnectedDevices('Device AA:BB:CC:DD:EE:FF'), [
    { address: 'AA:BB:CC:DD:EE:FF', name: '' },
  ]);
});

test('parseConnectedDevices: empty/nullish input → []', () => {
  assert.deepEqual(parseConnectedDevices(''), []);
  assert.deepEqual(parseConnectedDevices(null), []);
  assert.deepEqual(parseConnectedDevices(undefined), []);
});

// ── parseBattery ──────────────────────────────────────────────────────────

test('parseBattery: extracts connected yes + battery percentage', () => {
  const out = [
    'Device AA:BB:CC:DD:EE:FF (public)',
    '\tName: 8BitDo SN30 Pro',
    '\tConnected: yes',
    '\tBattery Percentage: 0x4b (75)',
  ].join('\n');
  assert.deepEqual(parseBattery(out), { connected: true, battery: 75 });
});

test('parseBattery: connected no, no battery line → battery null', () => {
  const out = [
    '\tName: Xbox',
    '\tConnected: no',
  ].join('\n');
  assert.deepEqual(parseBattery(out), { connected: false, battery: null });
});

test('parseBattery: missing battery line → battery null but connected parsed', () => {
  const out = '\tConnected: yes\n';
  assert.deepEqual(parseBattery(out), { connected: true, battery: null });
});

test('parseBattery: empty/nullish → not connected, null battery', () => {
  assert.deepEqual(parseBattery(''), { connected: false, battery: null });
  assert.deepEqual(parseBattery(null), { connected: false, battery: null });
});

// ── pollBtInventory ───────────────────────────────────────────────────────

function makeExec(map) {
  return async (cmd) => {
    if (!(cmd in map)) throw new Error(`unexpected command: ${cmd}`);
    const v = map[cmd];
    if (v instanceof Error) throw v;
    return { stdout: v, stderr: '' };
  };
}

test('pollBtInventory: merges connected list with per-device battery info', async () => {
  const exec = makeExec({
    'bluetoothctl devices Connected':
      'Device AA:BB:CC:DD:EE:FF 8BitDo SN30 Pro\nDevice 11:22:33:44:55:66 Xbox',
    'bluetoothctl info AA:BB:CC:DD:EE:FF':
      '\tConnected: yes\n\tBattery Percentage: 0x4b (75)',
    'bluetoothctl info 11:22:33:44:55:66':
      '\tConnected: yes',
  });
  const devices = await pollBtInventory({ exec });
  assert.deepEqual(devices, [
    { address: 'AA:BB:CC:DD:EE:FF', name: '8BitDo SN30 Pro', connected: true, battery: 75 },
    { address: '11:22:33:44:55:66', name: 'Xbox', connected: true, battery: null },
  ]);
});

test('pollBtInventory: a failing info call does not sink the whole poll', async () => {
  const exec = makeExec({
    'bluetoothctl devices Connected':
      'Device AA:BB:CC:DD:EE:FF Good\nDevice 11:22:33:44:55:66 Bad',
    'bluetoothctl info AA:BB:CC:DD:EE:FF':
      '\tConnected: yes\n\tBattery Percentage: 0x64 (100)',
    'bluetoothctl info 11:22:33:44:55:66': new Error('device gone'),
  });
  const devices = await pollBtInventory({ exec });
  assert.deepEqual(devices, [
    { address: 'AA:BB:CC:DD:EE:FF', name: 'Good', connected: true, battery: 100 },
    { address: '11:22:33:44:55:66', name: 'Bad', connected: false, battery: null },
  ]);
});

test('pollBtInventory: bluetoothctl entirely unavailable → []', async () => {
  const exec = async () => { throw new Error('command not found: bluetoothctl'); };
  assert.deepEqual(await pollBtInventory({ exec }), []);
});
