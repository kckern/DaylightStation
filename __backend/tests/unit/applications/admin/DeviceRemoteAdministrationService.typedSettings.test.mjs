import { describe, expect, it, vi } from 'vitest';
import { DeviceRemoteAdministrationService } from '#apps/admin/DeviceRemoteAdministrationService.mjs';

const typed = () => [
  { key: 'webview.startUrl', type: 'string', value: 'https://daylight.test/piano', default: '', overridden: true },
  { key: 'webview.loadTimeoutSec', type: 'number', value: 20, default: 20, overridden: false },
  { key: 'debug.execEnabled', type: 'boolean', value: false, default: false, overridden: false },
  { key: 'update.channel', type: 'enum', value: 'stable' },
  { key: 'screen.brightness', type: 'integer', value: 120 },
  { key: 'pairing.token', type: 'string', value: 'do-not-show' },
];

function build(overrides = {}) {
  const gateway = {
    readStatus: vi.fn(async () => ({
      provider: 'daylight-android',
      device: { id: 'tablet' },
      summary: {},
      details: {},
      companionApps: [],
      unsupportedActions: ['screensaver-start', 'screensaver-stop'],
    })),
    readSettings: vi.fn(async () => ({ keepScreenOn: true })),
    readTypedSettings: vi.fn(async () => typed()),
    writeSetting: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
  const logger = { info: vi.fn(), warn: vi.fn() };
  return { service: new DeviceRemoteAdministrationService({ gateway, logger }), gateway, logger };
}

describe('DeviceRemoteAdministrationService on a device that describes its own settings', () => {
  it('passes the provider through in the status and leaves out actions the device does not have', async () => {
    const { service } = build();

    const status = await service.getStatus('tablet');

    expect(status.provider).toBe('daylight-android');
    expect(status.capabilities.actions).toContain('screen-on');
    expect(status.capabilities.actions).not.toContain('screensaver-start');
    expect(status.capabilities.actions).not.toContain('screensaver-stop');
    expect(status).not.toHaveProperty('unsupportedActions');
  });

  it('keeps every action for a gateway that names none as unsupported', async () => {
    const { service } = build({ readStatus: vi.fn(async () => ({ provider: 'fully-kiosk', device: { id: 'shield' } })) });
    const status = await service.getStatus('shield');
    expect(status.capabilities.actions).toContain('screensaver-start');
    expect(status.provider).toBe('fully-kiosk');
  });

  it('lists every setting the device lists and makes the typed ones editable', async () => {
    const { service, gateway } = build();

    const { settings } = await service.getSettings('tablet');

    expect(gateway.readSettings).not.toHaveBeenCalled();
    expect(settings).toEqual([
      { key: 'debug.execEnabled', type: 'boolean', value: false, editable: true, sensitive: false },
      { key: 'pairing.token', type: 'string', value: null, editable: false, sensitive: true },
      // An integer is shown and edited as a number; the whole-number check is on write.
      { key: 'screen.brightness', type: 'number', value: 120, editable: true, sensitive: false },
      { key: 'update.channel', type: 'string', value: 'stable', editable: false, sensitive: false },
      { key: 'webview.loadTimeoutSec', type: 'number', value: 20, editable: true, sensitive: false },
      { key: 'webview.startUrl', type: 'string', value: 'https://daylight.test/piano', editable: true, sensitive: false },
    ]);
  });

  it.each([
    ['debug.execEnabled', true, true, 'boolean'],
    ['webview.loadTimeoutSec', 30, 30, 'number'],
    ['webview.loadTimeoutSec', '45', 45, 'number'],
    ['webview.startUrl', ' https://daylight.test/home ', 'https://daylight.test/home', 'string'],
    ['webview.startUrl', '', '', 'string'],
    ['screen.brightness', 255, 255, 'number'],
    ['screen.brightness', '100000', 100000, 'number'],
    ['screen.brightness', -5, -5, 'number'],
    ['webview.loadTimeoutSec', 2.5, 2.5, 'number'],
  ])('writes %s = %j with its type kept', async (key, value, written, type) => {
    const { service, gateway } = build();

    const result = await service.updateSetting('tablet', key, value);

    expect(gateway.writeSetting).toHaveBeenCalledWith('tablet', key, written);
    expect(result.setting).toEqual({ key, type, value: written, editable: true, sensitive: false });
  });

  it.each([
    ['a key the device does not list', 'keepScreenOn', true],
    ['a credential-like key', 'pairing.token', 'x'],
    ['a setting whose type it cannot edit', 'update.channel', 'beta'],
    ['a string for a boolean', 'debug.execEnabled', 'true'],
    ['a non-number for a number', 'webview.loadTimeoutSec', 'soon'],
    ['a fraction for an integer', 'screen.brightness', 12.5],
    ['a non-number for an integer', 'screen.brightness', 'bright'],
    ['an empty value for an integer', 'screen.brightness', ''],
    ['an object for a string', 'webview.startUrl', { url: 'x' }],
    ['an over-long string', 'webview.startUrl', 'x'.repeat(5000)],
  ])('refuses %s without writing', async (_label, key, value) => {
    const { service, gateway } = build();
    await expect(service.updateSetting('tablet', key, value)).rejects.toMatchObject({ code: 'INVALID_REMOTE_DEVICE_INPUT' });
    expect(gateway.writeSetting).not.toHaveBeenCalled();
  });

  it('keeps the curated whitelist for a gateway whose settings are not self-describing', async () => {
    const { service, gateway } = build({ readTypedSettings: vi.fn(async () => null) });

    const { settings } = await service.getSettings('shield');
    expect(settings).toEqual([{ key: 'keepScreenOn', type: 'boolean', value: true, editable: true, sensitive: false }]);

    await service.updateSetting('shield', 'keepScreenOn', false);
    expect(gateway.writeSetting).toHaveBeenCalledWith('shield', 'keepScreenOn', false);
    await expect(service.updateSetting('shield', 'webview.startUrl', 'https://x.test/'))
      .rejects.toMatchObject({ code: 'INVALID_REMOTE_DEVICE_INPUT' });
  });

  it('works with a gateway that has no readTypedSettings at all', async () => {
    const { service, gateway } = build({ readTypedSettings: undefined });
    await service.updateSetting('shield', 'keepScreenOn', false);
    expect(gateway.writeSetting).toHaveBeenCalledWith('shield', 'keepScreenOn', false);
  });
});
