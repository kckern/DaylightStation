import { describe, expect, it, vi } from 'vitest';
import { DeviceRemoteAdministrationService } from '#apps/admin/DeviceRemoteAdministrationService.mjs';

const typed = () => [
  { key: 'webview.startUrl', type: 'string', value: 'https://daylight.test/piano', default: '', overridden: true },
  { key: 'webview.loadTimeoutSec', type: 'number', value: 20, default: 20, overridden: false },
  { key: 'debug.execEnabled', type: 'boolean', value: false, default: false, overridden: false },
  { key: 'update.channel', type: 'enum', value: 'stable' },
  { key: 'webview.bridgeOrigins', type: 'string', value: 'https://daylight.test' },
  { key: 'control.port', type: 'integer', value: 8780 },
  { key: 'lockdown.allowedApps', type: 'string', value: 'org.example.player' },
  { key: 'lockdown.required', type: 'BOOLEAN'.toLowerCase(), value: true },
  { key: 'webview.zoom', type: 'integer', value: 100 },
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
      // Listed, never editable: these widen what the device will do or who may drive it.
      { key: 'control.port', type: 'number', value: 8780, editable: false, sensitive: false },
      { key: 'debug.execEnabled', type: 'boolean', value: false, editable: false, sensitive: false },
      { key: 'lockdown.allowedApps', type: 'string', value: 'org.example.player', editable: false, sensitive: false },
      { key: 'lockdown.required', type: 'boolean', value: true, editable: false, sensitive: false },
      { key: 'pairing.token', type: 'string', value: null, editable: false, sensitive: true },
      // An integer is shown and edited as a number; the whole-number check is on write.
      { key: 'screen.brightness', type: 'number', value: 120, editable: true, sensitive: false },
      { key: 'update.channel', type: 'string', value: 'stable', editable: false, sensitive: false },
      { key: 'webview.bridgeOrigins', type: 'string', value: 'https://daylight.test', editable: false, sensitive: false },
      { key: 'webview.loadTimeoutSec', type: 'number', value: 20, editable: true, sensitive: false },
      { key: 'webview.startUrl', type: 'string', value: 'https://daylight.test/piano', editable: false, sensitive: false },
      { key: 'webview.zoom', type: 'number', value: 100, editable: true, sensitive: false },
    ]);
  });

  it.each([
    ['webview.loadTimeoutSec', 30, 30, 'number'],
    ['webview.loadTimeoutSec', '45', 45, 'number'],
    ['webview.zoom', '125', 125, 'number'],
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
    ['a key the device does not list', 'webview.notThere', true],
    ['a credential-like key', 'pairing.token', 'x'],
    ['a setting whose type it cannot edit', 'update.channel', 'beta'],
    ['a debug setting', 'debug.execEnabled', true],
    ['another debug setting', 'debug.anythingElse', true],
    ['the bridge origins', 'webview.bridgeOrigins', 'https://evil.test'],
    ['the start URL', 'webview.startUrl', 'https://evil.test/'],
    ['a control setting', 'control.port', 9999],
    ['a lockdown setting', 'lockdown.allowedApps', 'com.android.settings'],
    ['lockdown.required', 'lockdown.required', false],
    ['a non-number for a number', 'webview.loadTimeoutSec', 'soon'],
    ['a fraction for an integer', 'screen.brightness', 12.5],
    ['a non-number for an integer', 'screen.brightness', 'bright'],
    ['an empty value for an integer', 'screen.brightness', ''],
    ['a string for a whole number', 'webview.zoom', 'big'],
  ])('refuses %s without writing', async (_label, key, value) => {
    const { service, gateway } = build();
    await expect(service.updateSetting('tablet', key, value)).rejects.toMatchObject({ code: 'INVALID_REMOTE_DEVICE_INPUT' });
    expect(gateway.writeSetting).not.toHaveBeenCalled();
  });

  it('refuses debug.execEnabled with the error a non-whitelisted Fully key gets, and never reaches the gateway', async () => {
    const { service, gateway } = build();
    const typedError = await service.updateSetting('tablet', 'debug.execEnabled', true).catch(e => e);
    const fully = build({ readTypedSettings: vi.fn(async () => null) });
    const fullyError = await fully.service.updateSetting('shield', 'notOnTheList', true).catch(e => e);

    expect(typedError.code).toBe('INVALID_REMOTE_DEVICE_INPUT');
    expect(typedError.code).toBe(fullyError.code);
    expect(typedError.name).toBe(fullyError.name);
    expect(typedError.message).toBe('Setting is not editable from the Admin console: debug.execEnabled');
    expect(gateway.writeSetting).not.toHaveBeenCalled();
  });

  describe('order of checks on the curated (Fully) path', () => {
    const unreadable = () => build({
      readTypedSettings: vi.fn(async () => { throw new Error('devices file unreadable'); }),
      writeSetting: vi.fn(async () => { throw new Error('devices file unreadable'); }),
    });

    it('refuses a key off the whitelist before anything that reads the device list can fail', async () => {
      const { service } = unreadable();
      await expect(service.updateSetting('shield', 'notOnTheList', true))
        .rejects.toMatchObject({ code: 'INVALID_REMOTE_DEVICE_INPUT' });
    });

    it('refuses a bad value for a whitelisted key before anything that reads the device list can fail', async () => {
      const { service, gateway } = unreadable();
      await expect(service.updateSetting('shield', 'keepScreenOn', 'yes'))
        .rejects.toMatchObject({ code: 'INVALID_REMOTE_DEVICE_INPUT' });
      expect(gateway.readTypedSettings).not.toHaveBeenCalled();
    });

    it('still surfaces a gateway failure for a key off the whitelist on a device that describes its settings', async () => {
      const gatewayError = Object.assign(new Error('Kiosk app is unreachable'), { name: 'DeviceRemoteGatewayError', code: 'DAYLIGHT_ANDROID_UNREACHABLE' });
      const { service } = build({ readTypedSettings: vi.fn(async () => { throw gatewayError; }) });
      await expect(service.updateSetting('tablet', 'webview.zoom', 110)).rejects.toBe(gatewayError);
    });
  });

  it('refuses a Fully setting name on a device that describes its own settings', async () => {
    const { service, gateway } = build();
    await expect(service.updateSetting('tablet', 'keepScreenOn', true))
      .rejects.toMatchObject({ code: 'INVALID_REMOTE_DEVICE_INPUT' });
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
