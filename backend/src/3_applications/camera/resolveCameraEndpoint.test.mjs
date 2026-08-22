import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCameraEndpoint } from './resolveCameraEndpoint.mjs';

const configService = {
  getDeviceConfig: (id) => ({
    'driveway-camera': { type: 'ip-camera', host: '10.0.0.56', auth_ref: 'reolink' },
    'camera-nvr':      { type: 'nvr',       host: '10.0.0.70', auth_ref: 'reolink' },
  }[id] ?? null),
};

test('resolves host and auth_ref from devices.yml', () => {
  assert.deepEqual(
    resolveCameraEndpoint(configService, 'driveway-camera', null),
    { host: '10.0.0.56', authRef: 'reolink' },
  );
});

test('resolves the NVR the same way', () => {
  assert.deepEqual(
    resolveCameraEndpoint(configService, 'camera-nvr', null),
    { host: '10.0.0.70', authRef: 'reolink' },
  );
});

test('throws a named error for an unknown device rather than dialing undefined', () => {
  assert.throws(
    () => resolveCameraEndpoint(configService, 'ghost-camera', null),
    /ghost-camera/,
  );
});
