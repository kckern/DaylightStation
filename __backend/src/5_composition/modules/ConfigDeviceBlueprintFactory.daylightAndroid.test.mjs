import { describe, expect, it, vi } from 'vitest';
import { ConfigDeviceBlueprintFactory } from './ConfigDeviceBlueprintFactory.mjs';

const TOKEN = 'tok-super-secret';

function build({ auth = { 'piano-tablet': { host: 'kiosk.test', token: TOKEN } }, httpClient = { get() {}, post() {}, delete() {} } } = {}) {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const configService = { getHouseholdAuth: vi.fn(() => auth) };
  const made = name => vi.fn((config, deps) => ({ made: name, config, deps }));
  const factories = {
    fullyKiosk: made('fullyKiosk'),
    fullyKioskVolume: made('fullyKioskVolume'),
    daylightAndroid: made('daylightAndroid'),
    daylightAndroidVolume: made('daylightAndroidVolume'),
    adb: made('adb'),
    resilient: made('resilient'),
  };
  const factory = new ConfigDeviceBlueprintFactory({
    httpClient,
    configService,
    daylightHost: 'https://daylight.test',
    factories,
    logger,
  });
  return { factory, factories, configService, logger, httpClient };
}

const content = {
  provider: 'daylight-android',
  host: 'kiosk.test',
  port: 8780,
  auth_ref: 'daylight-android',
};

describe('ConfigDeviceBlueprintFactory daylight-android provider', () => {
  it('builds the content adapter with the token for this device id', async () => {
    const { factory, factories, configService, httpClient, logger } = build();

    const blueprint = await factory.createBlueprint('piano-tablet', { content_control: content });

    expect(configService.getHouseholdAuth).toHaveBeenCalledWith('daylight-android');
    expect(factories.daylightAndroid).toHaveBeenCalledTimes(1);
    const [config, deps] = factories.daylightAndroid.mock.calls[0];
    expect(config).toEqual({
      host: 'kiosk.test',
      port: 8780,
      token: TOKEN,
      daylightHost: 'https://daylight.test',
    });
    expect(deps.httpClient).toBe(httpClient);
    expect(deps.adbAdapter).toBeNull();
    expect(blueprint.capabilities.contentControl.made).toBe('daylightAndroid');
    expect(factories.fullyKiosk).not.toHaveBeenCalled();
    expect(factories.resilient).not.toHaveBeenCalled();
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(TOKEN);
  });

  it('warns, without the token, when the auth file has no entry for the device', async () => {
    const { factory, factories, logger } = build({ auth: { 'other-tablet': { token: TOKEN } } });

    await factory.createBlueprint('piano-tablet', { content_control: content });

    expect(factories.daylightAndroid.mock.calls[0][0].token).toBe('');
    expect(logger.warn).toHaveBeenCalledWith('deviceFactory.noAuthToken', {
      auth_ref: 'daylight-android', deviceId: 'piano-tablet',
    });
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(TOKEN);
  });

  it('hands an ADB fallback to the adapter for the camera probe, without the resilient wrapper', async () => {
    const { factory, factories } = build();

    const blueprint = await factory.createBlueprint('piano-tablet', {
      content_control: { ...content, fallback: { provider: 'adb', host: 'kiosk.test', port: 5555, launch_activity: 'x/.Y' } },
    });

    expect(factories.adb).toHaveBeenCalledWith({ host: 'kiosk.test', port: 5555 }, expect.any(Object));
    expect(factories.daylightAndroid.mock.calls[0][1].adbAdapter.made).toBe('adb');
    expect(factories.resilient).not.toHaveBeenCalled();
    expect(blueprint.capabilities.contentControl.made).toBe('daylightAndroid');
  });

  it('builds no content control without an http client', async () => {
    const { factory, factories, logger } = build({ httpClient: null });
    const blueprint = await factory.createBlueprint('piano-tablet', { content_control: content });
    expect(blueprint.capabilities.contentControl).toBeNull();
    expect(factories.daylightAndroid).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('deviceFactory.noHttpClient');
  });

  it('builds the volume adapter from the content control address and token', async () => {
    const { factory, factories } = build();

    const blueprint = await factory.createBlueprint('piano-tablet', {
      content_control: content,
      volume: { provider: 'daylight-android', stream: 3, cap: 60 },
    });

    expect(factories.daylightAndroidVolume).toHaveBeenCalledTimes(1);
    expect(factories.daylightAndroidVolume.mock.calls[0][0]).toEqual({
      host: 'kiosk.test', port: 8780, token: TOKEN, stream: 3,
    });
    expect(blueprint.capabilities.volumeControl.made).toBe('daylightAndroidVolume');
    expect(blueprint.descriptor.volumeCap).toBe(60);
    expect(factories.fullyKioskVolume).not.toHaveBeenCalled();
  });

  it('refuses a daylight-android volume block on a device whose content control is another provider', async () => {
    const { factory, factories, logger } = build();

    const blueprint = await factory.createBlueprint('piano-tablet', {
      content_control: { provider: 'fully-kiosk', host: 'fully.test', port: 2323, password: 'pw' },
      volume: { provider: 'daylight-android' },
    });

    expect(blueprint.capabilities.volumeControl).toBeNull();
    expect(factories.daylightAndroidVolume).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('deviceFactory.volumeWithoutDaylightAndroidContent', {
      contentProvider: 'fully-kiosk',
    });
  });

  it('leaves the fully-kiosk path as it was', async () => {
    const { factory, factories } = build({ auth: { password: 'fkb-pw' } });

    const blueprint = await factory.createBlueprint('panel', {
      content_control: { provider: 'fully-kiosk', host: 'fully.test', port: 2323, auth_ref: 'fullykiosk', companion_apps: ['a.b'] },
      volume: { provider: 'fully-kiosk' },
    });

    expect(factories.fullyKiosk.mock.calls[0][0]).toEqual({
      host: 'fully.test',
      port: 2323,
      password: 'fkb-pw',
      daylightHost: 'https://daylight.test',
      launchActivity: null,
      companionApps: ['a.b'],
      cameraCheckPaths: undefined,
    });
    expect(factories.fullyKioskVolume.mock.calls[0][0]).toEqual({
      host: 'fully.test', port: 2323, password: 'fkb-pw', stream: undefined,
    });
    expect(blueprint.capabilities.contentControl.made).toBe('fullyKiosk');
    expect(factories.daylightAndroid).not.toHaveBeenCalled();
    expect(factories.daylightAndroidVolume).not.toHaveBeenCalled();
  });
});
