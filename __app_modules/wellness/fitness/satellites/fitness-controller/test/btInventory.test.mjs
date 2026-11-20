import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseConnectedDevices,
  parseBattery,
  pollBtInventory,
  parseDeviceKind,
  parseHasHidService,
  startBtInventoryBroadcast,
  hasInputDevice,
  nextReconnectDelay,
  shouldReconnect,
} from "../src/btInventory.mjs";

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

test('parseDeviceKind: maps the bluetoothctl Icon line to a kind', () => {
  assert.equal(parseDeviceKind('\tIcon: input-gaming'), 'gamepad');
  assert.equal(parseDeviceKind('\tIcon: input-keyboard'), 'keyboard');
  assert.equal(parseDeviceKind('\tIcon: input-mouse'), 'mouse');
  assert.equal(parseDeviceKind('\tIcon: input-tablet'), 'tablet');
  assert.equal(parseDeviceKind('\tIcon: audio-card'), null);
  assert.equal(parseDeviceKind(''), null);
});

test('parseHasHidService: true for a HID or HID-over-GATT UUID line, case-insensitive', () => {
  assert.equal(parseHasHidService('\tUUID: Human Interface Device... (00001124-0000-1000-8000-00805f9b34fb)'), true);
  assert.equal(parseHasHidService('\tUUID: Human Interface Device (00001812-0000-1000-8000-00805F9B34FB)'), true);
  // A speaker: AVRCP + audio sink, no HID.
  assert.equal(parseHasHidService([
    '\tUUID: Audio Sink                (0000110b-0000-1000-8000-00805f9b34fb)',
    '\tUUID: A/V Remote Control        (0000110e-0000-1000-8000-00805f9b34fb)',
  ].join('\n')), false);
  // The HID UUID outside a UUID: line does not count.
  assert.equal(parseHasHidService('\tModalias: 00001124-0000-1000-8000-00805f9b34fb'), false);
  assert.equal(parseHasHidService(''), false);
  assert.equal(parseHasHidService(null), false);
});

// ── pollBtInventory ───────────────────────────────────────────────────────

const NO_INPUT = async () => "";

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
    'bluetoothctl --agent off devices Paired':
      'Device AA:BB:CC:DD:EE:FF 8BitDo SN30 Pro\nDevice 11:22:33:44:55:66 Xbox',
    'bluetoothctl --agent off info AA:BB:CC:DD:EE:FF':
      '\tConnected: yes\n\tBattery Percentage: 0x4b (75)',
    'bluetoothctl --agent off info 11:22:33:44:55:66':
      '\tConnected: yes',
  });
  const devices = await pollBtInventory({ exec, readInputDevices: NO_INPUT });
  assert.deepEqual(devices, [
    { address: 'AA:BB:CC:DD:EE:FF', name: '8BitDo SN30 Pro', connected: true, battery: 75, paired: true, trusted: false, gamepad: false, kind: null, input: false, hid: false },
    { address: '11:22:33:44:55:66', name: 'Xbox', connected: true, battery: null, paired: true, trusted: false, gamepad: false, kind: null, input: false, hid: false },
  ]);
});

test('pollBtInventory: a failing info call does not sink the whole poll', async () => {
  const exec = makeExec({
    'bluetoothctl --agent off devices Paired':
      'Device AA:BB:CC:DD:EE:FF Good\nDevice 11:22:33:44:55:66 Bad',
    'bluetoothctl --agent off info AA:BB:CC:DD:EE:FF':
      '\tConnected: yes\n\tBattery Percentage: 0x64 (100)',
    'bluetoothctl --agent off info 11:22:33:44:55:66': new Error('device gone'),
  });
  const devices = await pollBtInventory({ exec, readInputDevices: NO_INPUT });
  assert.deepEqual(devices, [
    { address: 'AA:BB:CC:DD:EE:FF', name: 'Good', connected: true, battery: 100, paired: true, trusted: false, gamepad: false, kind: null, input: false, hid: false },
    { address: '11:22:33:44:55:66', name: 'Bad', connected: false, battery: null, paired: true, trusted: false, gamepad: false, kind: null, input: false, hid: false },
  ]);
});

test('pollBtInventory: a paired pad that is asleep reports connected:false (trusted gamepad, no input)', async () => {
  const exec = makeExec({
    'bluetoothctl --agent off devices Paired': 'Device E4:17:D8:C6:54:F0 8Bitdo SFC30 GamePad',
    'bluetoothctl --agent off info E4:17:D8:C6:54:F0': '\tPaired: yes\n\tTrusted: yes\n\tIcon: input-gaming\n\tConnected: no\n\tUUID: Human Interface Device... (00001124-0000-1000-8000-00805f9b34fb)',
  });
  assert.deepEqual(await pollBtInventory({ exec, readInputDevices: NO_INPUT }), [
    { address: 'E4:17:D8:C6:54:F0', name: '8Bitdo SFC30 GamePad', connected: false, battery: null, paired: true, trusted: true, gamepad: true, kind: 'gamepad', input: false, hid: true },
  ]);
});

test('pollBtInventory: input reflects the kernel input table, by MAC', async () => {
  const exec = makeExec({
    'bluetoothctl --agent off devices Paired': 'Device E4:17:D8:C6:54:F0 8Bitdo SFC30 GamePad',
    'bluetoothctl --agent off info E4:17:D8:C6:54:F0': '\tTrusted: yes\n\tIcon: input-gaming\n\tConnected: yes',
  });
  const table = 'N: Name="8Bitdo SFC30 GamePad"\nU: Uniq=e4:17:d8:c6:54:f0\n';
  const [d] = await pollBtInventory({ exec, readInputDevices: async () => table });
  assert.equal(d.input, true);
  assert.equal(hasInputDevice(table, 'AA:BB:CC:DD:EE:FF'), false);
});

test('pollBtInventory: a connected device with no bond is reported paired:false', async () => {
  const exec = makeExec({
    'bluetoothctl --agent off devices Paired': '',
    'bluetoothctl --agent off devices Connected': 'Device E4:17:D8:C6:54:F0 8Bitdo SFC30 GamePad',
    'bluetoothctl --agent off info E4:17:D8:C6:54:F0': '\tPaired: no\n\tConnected: yes',
  });
  const [d] = await pollBtInventory({ exec, readInputDevices: NO_INPUT });
  assert.equal(d.paired, false);
  assert.equal(d.connected, true);
});

test('startBtInventoryBroadcast: an unbonded pad dialing in stays "attempting" between sightings, then ages out', async () => {
  let t = 1000;
  let dialing = true;
  const exec = async (cmd) => {
    if (cmd.endsWith('devices Paired')) return { stdout: '' };
    if (cmd.endsWith('devices Connected')) return { stdout: dialing ? 'Device E4:17:D8:C6:54:F0 8Bitdo SFC30 GamePad' : '' };
    return { stdout: '\tPaired: no\n\tConnected: yes' };
  };
  const sent = [];
  const handle = startBtInventoryBroadcast({
    intervalMs: 60000, exec, readInputDevices: NO_INPUT, now: () => t, unbondedMemoryMs: 5000, logger: null,
    send: (topic, payload) => { sent.push(payload.devices); return true; },
  });
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(sent.at(-1)[0].attempting, true);
  dialing = false;            // rejected by the kernel; between redials
  t += 2000;
  await handle.resend();
  assert.equal(sent.at(-1).length, 1);
  assert.equal(sent.at(-1)[0].attempting, true);
  assert.equal(sent.at(-1)[0].connected, false);
  t += 10000;                 // gave up dialing
  await handle.resend();
  assert.equal(sent.at(-1).length, 0);
  handle.stop();
});

test('startBtInventoryBroadcast: reconnects a trusted, asleep gamepad with backoff; pause() stops it', async () => {
  let t = 0;
  const connects = [];
  const exec = async (cmd) => {
    if (cmd.endsWith('devices Paired')) return { stdout: 'Device E4:17:D8:C6:54:F0 8Bitdo SFC30 GamePad' };
    if (cmd.endsWith('devices Connected')) return { stdout: '' };
    if (cmd.includes(' connect ')) { connects.push(t); throw new Error('Device not available'); }
    return { stdout: '\tPaired: yes\n\tTrusted: yes\n\tIcon: input-gaming\n\tConnected: no' };
  };
  const handle = startBtInventoryBroadcast({
    intervalMs: 60000, exec, readInputDevices: NO_INPUT, now: () => t, logger: null, send: () => true,
  });
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(connects.length, 1);
  t = 10000; await handle.resend();   // inside the 30s backoff → no attempt
  assert.equal(connects.length, 1);
  t = 31000; await handle.resend();   // past it → second attempt, next gap 60s
  assert.equal(connects.length, 2);
  handle.pause();
  t = 500000; await handle.resend();  // paused (pairing window) → nothing
  assert.equal(connects.length, 2);
  handle.stop();
});

test('nextReconnectDelay: 30s then doubles, capped at 10 min', () => {
  assert.equal(nextReconnectDelay(0), 30000);
  assert.equal(nextReconnectDelay(30000), 60000);
  assert.equal(nextReconnectDelay(480000), 600000);
  assert.equal(nextReconnectDelay(600000), 600000);
});

test('pollBtInventory: bluetoothctl entirely unavailable → []', async () => {
  const exec = async () => { throw new Error('command not found: bluetoothctl'); };
  assert.deepEqual(await pollBtInventory({ exec }), []);
});

// ── startBtInventoryBroadcast ─────────────────────────────────────────────

const flush = () => new Promise((r) => setImmediate(r));
const fakeExec = async (cmd) => (cmd === 'bluetoothctl --agent off devices Paired'
  ? { stdout: 'Device E4:17:D8:C6:54:F0 8Bitdo SFC30 GamePad' }
  : { stdout: 'Connected: yes' });

test('startBtInventoryBroadcast: a failed send is retried, not recorded as sent', async () => {
  // Garage, 2026-10-02: the first poll ran before the WS opened, the send
  // failed, and the unchanged inventory was then never sent at all.
  let open = false;
  const sent = [];
  const handle = startBtInventoryBroadcast({
    intervalMs: 60000, exec: fakeExec, logger: null,
    send: (topic, payload) => { if (!open) return false; sent.push(payload); return true; },
  });
  await flush();
  assert.equal(sent.length, 0);
  open = true;
  await handle.resend();
  assert.equal(sent.length, 1);
  await handle.resend(); // unchanged + already delivered → resend() still forces it
  assert.equal(sent.length, 2);
  handle.stop();
});

test('hasInputDevice: same rule as the pairing helper (input_device_present)', () => {
  const blankUniqBt = 'I: Bus=0005 Vendor=1234 Product=5678 Version=0001\nN: Name="Ring Remote"\nU: Uniq=\n';
  const missingUniqBt = 'I: Bus=0005 Vendor=1234 Product=5678 Version=0001\nN: Name="Ring Remote"\n';
  const usb = 'I: Bus=0003 Vendor=1234 Product=5678 Version=0001\nN: Name="Ring Remote"\nU: Uniq=\n';
  const byUniq = 'I: Bus=0005 Vendor=2dc8 Product=ab21 Version=0001\nN: Name="8Bitdo SFC30 GamePad"\nU: Uniq=e4:17:d8:c6:54:f0\n';
  // Blank or missing Uniq on a Bluetooth block: exact name match counts.
  assert.equal(hasInputDevice(blankUniqBt, 'AA:BB:CC:DD:EE:FF', 'Ring Remote'), true);
  assert.equal(hasInputDevice(missingUniqBt, 'AA:BB:CC:DD:EE:FF', 'Ring Remote'), true);
  // Name must be exact, and must be given.
  assert.equal(hasInputDevice(blankUniqBt, 'AA:BB:CC:DD:EE:FF', 'Ring'), false);
  assert.equal(hasInputDevice(blankUniqBt, 'AA:BB:CC:DD:EE:FF'), false);
  // A USB block (Bus=0003) never matches by name.
  assert.equal(hasInputDevice(usb, 'AA:BB:CC:DD:EE:FF', 'Ring Remote'), false);
  // Uniq match still works; a Uniq for another MAC does not fall back to the name.
  assert.equal(hasInputDevice(byUniq, 'E4:17:D8:C6:54:F0', 'whatever'), true);
  assert.equal(hasInputDevice(byUniq, 'AA:BB:CC:DD:EE:FF', '8Bitdo SFC30 GamePad'), false);
  // Blocks are separate: a name in one block and a blank Uniq in another do not combine.
  assert.equal(hasInputDevice(`${usb}\n${byUniq}`, 'AA:BB:CC:DD:EE:FF', 'Ring Remote'), false);
});

test('pollBtInventory: input passes the device name for the blank-Uniq fallback', async () => {
  const exec = makeExec({
    'bluetoothctl --agent off devices Paired': 'Device AA:BB:CC:DD:EE:FF Ring Remote',
    'bluetoothctl --agent off info AA:BB:CC:DD:EE:FF': '\tTrusted: yes\n\tIcon: input-keyboard\n\tConnected: yes',
  });
  const table = 'I: Bus=0005 Vendor=1234 Product=5678 Version=0001\nN: Name="Ring Remote"\nU: Uniq=\n';
  const [d] = await pollBtInventory({ exec, readInputDevices: async () => table });
  assert.equal(d.input, true);
});

test('shouldReconnect: any trusted, bonded input device; never a speaker or an unbonded one', () => {
  assert.equal(shouldReconnect({ trusted: true, gamepad: true }), true);
  assert.equal(shouldReconnect({ trusted: true, kind: 'keyboard' }), true);
  assert.equal(shouldReconnect({ trusted: true, hid: true }), true);           // BLE ring with no Icon
  assert.equal(shouldReconnect({ trusted: false, kind: 'keyboard' }), false);
  assert.equal(shouldReconnect({ trusted: true, kind: null, hid: false }), false); // speaker
  assert.equal(shouldReconnect({ trusted: true, kind: 'keyboard', paired: false }), false);
});

test('startBtInventoryBroadcast: reconnects a trusted keyboard; pause({reconnectOnly}) keeps the poll, stops reconnects', async () => {
  let t = 0;
  const connects = [];
  const sends = [];
  const exec = async (cmd) => {
    if (cmd.endsWith('devices Paired')) return { stdout: 'Device AA:BB:CC:11:22:33 R1' };
    if (cmd.endsWith('devices Connected')) return { stdout: '' };
    if (cmd.includes(' connect ')) { connects.push(t); throw new Error('not available'); }
    return { stdout: '\tPaired: yes\n\tTrusted: yes\n\tIcon: input-keyboard\n\tConnected: no' };
  };
  const handle = startBtInventoryBroadcast({
    intervalMs: 60000, exec, readInputDevices: NO_INPUT, now: () => t, logger: null, send: (topic) => { sends.push(topic); return true; },
  });
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(connects.length, 1);
  handle.pause({ reconnectOnly: true });
  t = 500000;
  await handle.resend();
  assert.equal(connects.length, 1);               // no reconnect during a search
  assert.equal(sends.filter((s) => s === 'bt_inventory').length, 2); // but the poll still sends
  handle.stop();
});
