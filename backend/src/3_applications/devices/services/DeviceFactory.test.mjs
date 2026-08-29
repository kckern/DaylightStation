import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeviceFactory } from './DeviceFactory.mjs';

test('DeviceFactory constructs a Device only from a semantic blueprint', async () => {
  const calls = [];
  const contentControl = { load: async () => ({ ok: true }) };
  const factory = new DeviceFactory({
    blueprintFactory: {
      async createBlueprint(deviceId, source) {
        calls.push({ deviceId, source });
        return {
          descriptor: { id: deviceId, type: 'screen', screenPath: '/screen/test' },
          capabilities: { deviceControl: null, osControl: null, contentControl },
        };
      },
    },
    logger: { debug() {} },
  });

  const source = { opaque: 'deployment input' };
  const device = await factory.build('test-screen', source);

  assert.deepEqual(calls, [{ deviceId: 'test-screen', source }]);
  assert.equal(device.id, 'test-screen');
  assert.equal(device.type, 'screen');
  assert.equal(device.screenPath, '/screen/test');
});

test('DeviceFactory rejects a non-semantic construction dependency', () => {
  assert.throws(() => new DeviceFactory({}), /blueprintFactory\.createBlueprint/);
});
