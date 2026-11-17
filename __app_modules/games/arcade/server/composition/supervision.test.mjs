import { describe, it, expect } from 'vitest';
import { createArcadeSupervisionConsumers } from './supervision.mjs';

const quiet = { debug() {}, info() {}, warn() {}, error() {} };
const httpClient = { get: async () => ({ status: 200, data: { ok: true } }), post: async () => ({ status: 200, data: { ok: true } }), delete: async () => ({ status: 200, data: { ok: true } }) };
const configService = {
  getHouseholdAuth: (ref) => (ref === 'fullykiosk' ? { password: 'pw' } : { 'livingroom-tv': { token: 't' } }),
  getHouseholdAppConfig: () => ({}),
};
const adb = { provider: 'adb', host: 'device.test', port: 5555 };
const build = (devices, declared) => createArcadeSupervisionConsumers({
  configuration: { devices: declared },
  devicesConfig: { devices },
  configService, httpClient, logger: quiet, gamesCatalog: null, householdId: 'default',
});

describe('arcade supervision consumers', () => {
  it('builds one consumer per declared native package on a Fully device', () => {
    const consumers = build(
      { 'den-tv': { content_control: { provider: 'fully-kiosk', host: 'fully.test', port: 2323, auth_ref: 'fullykiosk', fallback: adb } } },
      [{ id: 'den-tv', native_packages: ['com.example.emulator', 'com.example.other'] }],
    );
    expect(consumers.map(c => c.capability)).toEqual(['native:com.example.emulator', 'native:com.example.other']);
  });

  it('builds consumers for a device on the Android kiosk app', () => {
    const consumers = build(
      { 'livingroom-tv': { content_control: { provider: 'daylight-android', host: 'kiosk.test', port: 8780, auth_ref: 'daylight-android', fallback: adb } } },
      [{ id: 'livingroom-tv', native_packages: ['com.example.emulator'] }],
    );
    expect(consumers).toHaveLength(1);
    expect(consumers[0]).toMatchObject({ deviceId: 'livingroom-tv', capability: 'native:com.example.emulator' });
  });

  it('builds nothing for a device with no ADB channel or no declared packages', () => {
    expect(build(
      { 'livingroom-tv': { content_control: { provider: 'daylight-android', host: 'kiosk.test' } } },
      [{ id: 'livingroom-tv', native_packages: ['com.example.emulator'] }],
    )).toEqual([]);
    expect(build(
      { 'den-tv': { content_control: { provider: 'fully-kiosk', host: 'fully.test', fallback: adb } } },
      [{ id: 'den-tv' }],
    )).toEqual([]);
  });
});
