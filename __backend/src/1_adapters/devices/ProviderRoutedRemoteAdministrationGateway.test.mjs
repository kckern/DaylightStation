import { describe, expect, it, vi } from 'vitest';
import { ProviderRoutedRemoteAdministrationGateway } from './ProviderRoutedRemoteAdministrationGateway.mjs';
import { FullyKioskRemoteAdministrationAdapter } from './FullyKioskRemoteAdministrationAdapter.mjs';
import { DaylightAndroidRemoteAdministrationAdapter } from './DaylightAndroidRemoteAdministrationAdapter.mjs';

const devices = {
  shield: { content_control: { provider: 'fully-kiosk', host: 'fully.test', port: 2323, auth_ref: 'fullykiosk' } },
  tablet: { content_control: { provider: 'daylight-android', host: 'kiosk.test', port: 8780, auth_ref: 'daylight-android' } },
  pc: { content_control: { provider: 'websocket', topic: 'office' } },
  speaker: {},
};

function fakeGateway(name) {
  return {
    readStatus: vi.fn(async id => `${name}:status:${id}`),
    captureScreenshot: vi.fn(async id => `${name}:shot:${id}`),
    readSettings: vi.fn(async id => `${name}:settings:${id}`),
    executeAction: vi.fn(async (id, action, params) => ({ name, id, action, params })),
    writeSetting: vi.fn(async (id, key, value) => ({ name, id, key, value })),
  };
}

function build() {
  const fully = fakeGateway('fully');
  const daylight = fakeGateway('daylight');
  const gateway = new ProviderRoutedRemoteAdministrationGateway({
    readDevices: () => devices,
    gateways: { 'daylight-android': daylight },
    fallback: fully,
  });
  return { gateway, fully, daylight };
}

describe('ProviderRoutedRemoteAdministrationGateway', () => {
  it('requires readDevices and a fallback gateway', () => {
    expect(() => new ProviderRoutedRemoteAdministrationGateway({ fallback: fakeGateway('x') })).toThrow(/readDevices/);
    expect(() => new ProviderRoutedRemoteAdministrationGateway({ readDevices: () => ({}) })).toThrow(/fallback/);
  });

  it('sends each port method for a daylight-android device to its gateway', async () => {
    const { gateway, fully, daylight } = build();

    await expect(gateway.readStatus('tablet')).resolves.toBe('daylight:status:tablet');
    await expect(gateway.captureScreenshot('tablet')).resolves.toBe('daylight:shot:tablet');
    await expect(gateway.readSettings('tablet')).resolves.toBe('daylight:settings:tablet');
    await expect(gateway.executeAction('tablet', 'set-volume', { level: 4 }))
      .resolves.toEqual({ name: 'daylight', id: 'tablet', action: 'set-volume', params: { level: 4 } });
    await expect(gateway.writeSetting('tablet', 'k', true))
      .resolves.toEqual({ name: 'daylight', id: 'tablet', key: 'k', value: true });

    for (const method of Object.values(fully)) expect(method).not.toHaveBeenCalled();
    expect(daylight.readStatus).toHaveBeenCalledTimes(1);
  });

  it('sends a fully-kiosk device to the fallback gateway', async () => {
    const { gateway, fully, daylight } = build();

    await expect(gateway.readStatus('shield')).resolves.toBe('fully:status:shield');
    await expect(gateway.executeAction('shield', 'reboot', {}))
      .resolves.toEqual({ name: 'fully', id: 'shield', action: 'reboot', params: {} });

    for (const method of Object.values(daylight)) expect(method).not.toHaveBeenCalled();
  });

  it.each(['pc', 'speaker', 'missing', '../etc', undefined, '__proto__'])(
    'leaves %s to the fallback gateway, which owns those errors',
    async (deviceId) => {
      const { gateway, fully, daylight } = build();
      await gateway.readSettings(deviceId);
      expect(fully.readSettings).toHaveBeenCalledWith(deviceId);
      expect(daylight.readSettings).not.toHaveBeenCalled();
    },
  );

  it('serves a fleet with both providers through the real adapters', async () => {
    const httpClient = {
      get: vi.fn(async url => (url.startsWith('http://fully.test')
        ? { status: 200, data: { startURL: 'https://daylight.test/' } }
        : { status: 200, data: { ok: true, settings: [{ key: 'webview.startUrl', value: 'https://daylight.test/piano' }] } })),
      post: vi.fn(),
      delete: vi.fn(),
    };
    const logger = { debug() {}, info() {}, warn() {}, error() {} };
    const resolveAuth = ref => (ref === 'fullykiosk' ? { password: 'pw' } : { tablet: { token: 'tok' } });
    const shared = { readDevices: () => devices, resolveAuth, httpClient, logger };
    const gateway = new ProviderRoutedRemoteAdministrationGateway({
      readDevices: shared.readDevices,
      gateways: { 'daylight-android': new DaylightAndroidRemoteAdministrationAdapter(shared) },
      fallback: new FullyKioskRemoteAdministrationAdapter(shared),
    });

    await expect(gateway.readSettings('shield')).resolves.toEqual({ startURL: 'https://daylight.test/' });
    await expect(gateway.readSettings('tablet')).resolves.toEqual({ 'webview.startUrl': 'https://daylight.test/piano' });
    await expect(gateway.readSettings('pc')).rejects.toMatchObject({ code: 'NOT_FULLY_KIOSK' });
    await expect(gateway.readSettings('missing')).rejects.toMatchObject({ code: 'DEVICE_NOT_FOUND' });
    await expect(gateway.readSettings('../etc')).rejects.toMatchObject({ code: 'INVALID_DEVICE_ID' });
  });
});
