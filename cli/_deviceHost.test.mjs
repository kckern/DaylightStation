import { describe, it, expect } from 'vitest';
import { resolveDeviceHost } from './_deviceHost.mjs';

const registry = (devices) => async () => ({ ok: true, json: async () => ({ devices }) });

describe('resolveDeviceHost', () => {
  it('uses the host env var first, adding the default port', async () => {
    await expect(resolveDeviceHost({ hostVar: 'H', deviceVar: 'D', port: 8770, env: { H: '192.0.2.5' } }))
      .resolves.toBe('192.0.2.5:8770');
    await expect(resolveDeviceHost({ hostVar: 'H', deviceVar: 'D', port: 8770, env: { H: '192.0.2.5:9' } }))
      .resolves.toBe('192.0.2.5:9');
  });

  it('reads a device address from the registry', async () => {
    const fetchImpl = registry({ tab: { content_control: { host: '192.0.2.7' } }, rec: { host: '192.0.2.8' } });
    await expect(resolveDeviceHost({ hostVar: 'H', deviceVar: 'D', port: 2323, env: { D: 'tab' }, fetchImpl }))
      .resolves.toBe('192.0.2.7:2323');
    await expect(resolveDeviceHost({ hostVar: 'H', deviceVar: 'D', deviceId: 'rec', port: 80, env: {}, fetchImpl }))
      .resolves.toBe('192.0.2.8:80');
  });

  it('fails with a message naming both ways when nothing is set', async () => {
    await expect(resolveDeviceHost({ hostVar: 'PB_HOST', deviceVar: 'PB_DEVICE', port: 8770, env: {} }))
      .rejects.toThrow(/PB_HOST.*PB_DEVICE/);
  });

  it('fails when the device has no address', async () => {
    await expect(resolveDeviceHost({ hostVar: 'H', deviceVar: 'D', port: 1, env: { D: 'x' }, fetchImpl: registry({ x: {} }) }))
      .rejects.toThrow(/no content_control.host/);
  });
});
