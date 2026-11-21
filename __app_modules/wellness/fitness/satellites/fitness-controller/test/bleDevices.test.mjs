import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLEManager, normalizeDeviceMap, devicesFromEquipment, loadLocalDeviceFile } from '../src/ble.mjs';
import { RenphoJumpropeDecoder } from '../src/decoders/jumprope.mjs';

const ROPE = { id: 'rope_a', name: 'Rope A', type: 'jumprope', ble: 'AA:BB:CC:00:00:01' };

test('equipment with a ble address and a decodable type becomes a monitored device', () => {
  const out = devicesFromEquipment([
    ROPE,
    { id: 'bike_a', type: 'stationary_bike', cadence: 101 },
    { id: 'odd', type: 'toaster', ble: 'AA:BB:CC:00:00:02' },
  ]);
  assert.deepEqual(Object.keys(out), ['rope_a']);
  assert.deepEqual(out.rope_a, {
    name: 'Rope A', address: 'AA:BB:CC:00:00:01',
    characteristic: RenphoJumpropeDecoder.CHARACTERISTIC, type: 'jumprope',
  });
});

test('config may override the decoder characteristic', () => {
  const out = devicesFromEquipment([{ ...ROPE, ble_characteristic: '0000fff1-0000-1000-8000-00805f9b34fb' }]);
  assert.equal(out.rope_a.characteristic, '0000fff1-0000-1000-8000-00805f9b34fb');
});

test('normalizeDeviceMap (local file shape) drops entries without an address or decoder', () => {
  const out = normalizeDeviceMap({
    rope_b: { name: 'Rope B', address: 'AA:BB:CC:00:00:02', type: 'jumprope' },
    no_address: { type: 'jumprope' },
    odd_type: { address: 'AA:BB:CC:00:00:03', type: 'toaster' },
  });
  assert.deepEqual(Object.keys(out), ['rope_b']);
});

test('app config equipment wins over the local file', () => {
  const m = new BLEManager(() => {});
  const keys = m.configureDevices([ROPE], { rope_b: { address: 'AA:BB:CC:00:00:02', type: 'jumprope' } });
  assert.deepEqual(keys, ['rope_a']);
  assert.equal(m.deviceSource, 'app-config');
});

test('local file is used when the app config names no BLE equipment', () => {
  const m = new BLEManager(() => {});
  const keys = m.configureDevices(undefined, { rope_b: { address: 'AA:BB:CC:00:00:02', type: 'jumprope' } });
  assert.deepEqual(keys, ['rope_b']);
  assert.equal(m.deviceSource, 'local-file');
});

test('no configuration means no devices, and starting an unknown key fails', async () => {
  const m = new BLEManager(() => {});
  assert.deepEqual(m.configureDevices([], {}), []);
  assert.equal(m.deviceSource, 'none');
  assert.deepEqual(await m.startAllMonitoring(), {});
  assert.equal(await m.startMonitoring('anything'), false);
});

test('a missing local file reads as empty', () => {
  assert.deepEqual(loadLocalDeviceFile('/nonexistent/ble-devices.json'), {});
});
