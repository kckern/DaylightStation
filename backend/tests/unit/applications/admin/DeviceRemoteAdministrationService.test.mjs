import { describe, expect, it, vi } from 'vitest';
import { DeviceRemoteAdministrationService } from '#apps/admin/DeviceRemoteAdministrationService.mjs';

const EDITABLE_SETTING_KEYS = [
  'startURL',
  'screenBrightness',
  'screensaverBrightness',
  'screensaverWallpaperURL',
  'keepScreenOn',
  'preventSleepWhileScreenOff',
  'setWifiWakelock',
  'reloadOnWifiOn',
  'reloadOnInternet',
  'waitInternetOnReload',
  'restartOnCrash',
  'reloadOnScreenOn',
  'reloadOnScreensaverStop',
  'skipReloadIfStartUrlShowing',
  'autoplayAudio',
  'autoplayVideos',
  'enableFullscreenVideos',
  'enableZoom',
  'reloadPageFailure',
  'reloadOnIdle',
  'reloadEachSeconds',
  'timeToRestartUnresponsiveWebview',
  'screensaverTimeout',
];

const ACTIONS = [
  'screen-on',
  'screen-off',
  'set-brightness',
  'load-start-url',
  'load-url',
  'refresh',
  'reset-webview',
  'foreground',
  'restart-app',
  'screensaver-start',
  'screensaver-stop',
  'kiosk-lock',
  'kiosk-unlock',
  'maintenance-enable',
  'maintenance-disable',
  'overlay-message',
  'set-volume',
  'speak',
  'launch-app',
  'reboot',
];

function buildGateway(overrides = {}) {
  return {
    readStatus: vi.fn(async () => ({ device: { id: 'tablet' }, summary: {}, details: {} })),
    captureScreenshot: vi.fn(async () => ({ buffer: Buffer.from('png'), contentType: 'image/png' })),
    readSettings: vi.fn(async () => ({
      startURL: 'https://example.test/',
      keepScreenOn: true,
      authPassword: 'never-return-this',
      wifiKey: 'also-secret',
      keyboardShowSuggestions: true,
    })),
    executeAction: vi.fn(async () => ({ status: 'OK' })),
    writeSetting: vi.fn(async () => ({ status: 'OK' })),
    ...overrides,
  };
}

function expectInvalid(promise, field) {
  return expect(promise).rejects.toMatchObject({
    name: 'ValidationError',
    code: 'INVALID_REMOTE_DEVICE_INPUT',
    context: { field },
  });
}

describe('DeviceRemoteAdministrationService', () => {
  it('publishes the exact safe action surface with normalized status', async () => {
    const gateway = buildGateway();
    const service = new DeviceRemoteAdministrationService({ gateway });
    const result = await service.getStatus('tablet');

    expect(result.ok).toBe(true);
    expect(result.capabilities.actions).toEqual(ACTIONS);
    expect(result.capabilities.actions).not.toContain('inject-js');
    expect(result.fetchedAt).toEqual(expect.any(String));
    expect(gateway.readStatus).toHaveBeenCalledWith('tablet');
  });

  it('passes screenshot capture through without altering binary data', async () => {
    const screenshot = { buffer: Buffer.from('png'), contentType: 'image/png', capturedAt: 'now' };
    const gateway = buildGateway({ captureScreenshot: vi.fn(async () => screenshot) });
    const service = new DeviceRemoteAdministrationService({ gateway });

    await expect(service.getScreenshot('tablet')).resolves.toBe(screenshot);
    expect(gateway.captureScreenshot).toHaveBeenCalledWith('tablet');
  });

  it('masks every sensitive key pattern and exposes only the curated settings as editable', async () => {
    const raw = Object.fromEntries(EDITABLE_SETTING_KEYS.map(key => {
      if (/^(keep|prevent|setWifi|reloadOnWifi|reloadOnInternet|waitInternet|restartOnCrash|reloadOnScreen|reloadOnScreensaver|skipReload|autoplay|enable)/.test(key)) {
        return [key, true];
      }
      if (key.includes('URL')) return [key, 'https://example.test/'];
      return [key, 30];
    }));
    Object.assign(raw, {
      authPassword: 'hidden',
      apiSecret: 'hidden',
      accessToken: 'hidden',
      deviceCredential: 'hidden',
      wifiKey: 'hidden',
      sebConfigKey: 'hidden',
      sebExamKey: 'hidden',
      volumeLicenseKey: 'hidden',
      keyboardShowSuggestions: true,
    });
    const service = new DeviceRemoteAdministrationService({
      gateway: buildGateway({ readSettings: vi.fn(async () => raw) }),
    });

    const result = await service.getSettings('tablet');
    const editable = result.settings.filter(setting => setting.editable).map(setting => setting.key);
    expect(editable.sort()).toEqual([...EDITABLE_SETTING_KEYS].sort());
    for (const key of [
      'authPassword', 'apiSecret', 'accessToken', 'deviceCredential',
      'wifiKey', 'sebConfigKey', 'sebExamKey', 'volumeLicenseKey',
    ]) {
      expect(result.settings.find(setting => setting.key === key)).toMatchObject({
        value: null,
        sensitive: true,
        editable: false,
      });
    }
    expect(result.settings.find(setting => setting.key === 'keyboardShowSuggestions')).toMatchObject({
      value: true,
      type: 'boolean',
      editable: false,
      sensitive: false,
    });
    expect(result.settings.map(setting => setting.key)).toEqual(
      [...result.settings.map(setting => setting.key)].sort((left, right) => left.localeCompare(right)),
    );
  });

  it.each([
    ['screen-on', {}, {}],
    ['screen-off', {}, {}],
    ['set-brightness', { level: '137' }, { level: 137 }],
    ['load-start-url', {}, {}],
    ['load-url', { url: 'https://example.test/a?b=1' }, { url: 'https://example.test/a?b=1' }],
    ['refresh', {}, {}],
    ['reset-webview', {}, {}],
    ['foreground', {}, {}],
    ['restart-app', {}, {}],
    ['screensaver-start', {}, {}],
    ['screensaver-stop', {}, {}],
    ['kiosk-lock', {}, {}],
    ['kiosk-unlock', {}, {}],
    ['maintenance-enable', {}, {}],
    ['maintenance-disable', {}, {}],
    ['overlay-message', { text: '  Dinner is ready  ' }, { text: 'Dinner is ready' }],
    ['overlay-message', { text: '   ' }, { text: '' }],
    ['set-volume', { level: '42' }, { level: 42 }],
    ['speak', { text: '  Hello  ', locale: 'en_US' }, { text: 'Hello', locale: 'en-US' }],
    ['launch-app', { package: 'org.example.player_2' }, { package: 'org.example.player_2' }],
    ['reboot', {}, {}],
  ])('normalizes and executes %s', async (action, input, expected) => {
    const gateway = buildGateway();
    const service = new DeviceRemoteAdministrationService({ gateway });

    await expect(service.performAction('tablet', action, input)).resolves.toMatchObject({
      ok: true,
      action,
    });
    expect(gateway.executeAction).toHaveBeenCalledWith('tablet', action, expected);
  });

  it.each([
    ['set-brightness', { level: -1 }, 'level'],
    ['set-brightness', { level: 256 }, 'level'],
    ['set-brightness', { level: 1.5 }, 'level'],
    ['set-volume', { level: 101 }, 'level'],
    ['set-volume', { level: '' }, 'level'],
    ['load-url', { url: 'javascript:alert(1)' }, 'url'],
    ['load-url', { url: '/relative' }, 'url'],
    ['load-url', { url: 'file:///tmp/private' }, 'url'],
    ['overlay-message', { text: 'x'.repeat(501) }, 'text'],
    ['speak', { text: '' }, 'text'],
    ['speak', { text: 'x'.repeat(501) }, 'text'],
    ['speak', { text: 'hello', locale: 'english-US' }, 'locale'],
    ['launch-app', { package: 'bad package' }, 'package'],
    ['launch-app', { package: 'singleword' }, 'package'],
    ['launch-app', { package: 'org.example;rm' }, 'package'],
    ['load-url', { url: 'https://example.test/', host: 'attacker.test' }, 'host'],
    ['launch-app', { package: 'org.example.player', intent: 'android.intent.action.VIEW' }, 'intent'],
    ['screen-on', { debug: true }, 'debug'],
    ['screen-on', [], 'params'],
    ['screen-on', 'host=attacker.test', 'params'],
    ['inject-js', { code: 'alert(1)' }, 'action'],
    ['shell', { command: 'id' }, 'action'],
  ])('rejects unsafe or malformed action input %# before reaching the gateway', async (action, input, field) => {
    const gateway = buildGateway();
    const service = new DeviceRemoteAdministrationService({ gateway });

    await expectInvalid(service.performAction('tablet', action, input), field);
    expect(gateway.executeAction).not.toHaveBeenCalled();
  });

  it.each([
    ['keepScreenOn', false, false],
    ['screenBrightness', '255', 255],
    ['screenBrightness', '', ''],
    ['screensaverBrightness', null, ''],
    ['reloadPageFailure', '30', 30],
    ['screensaverTimeout', 86_400, 86_400],
    ['startURL', 'https://example.test/path', 'https://example.test/path'],
    ['screensaverWallpaperURL', 'fully://color#000000', 'fully://color#000000'],
    ['screensaverWallpaperURL', '', ''],
  ])('normalizes curated setting %s', async (key, input, expected) => {
    const gateway = buildGateway();
    const service = new DeviceRemoteAdministrationService({ gateway });

    await expect(service.updateSetting('tablet', key, input)).resolves.toMatchObject({
      ok: true,
      setting: { key, value: expected, editable: true, sensitive: false },
    });
    expect(gateway.writeSetting).toHaveBeenCalledWith('tablet', key, expected);
  });

  it.each([
    ['keepScreenOn', 'true'],
    ['screenBrightness', 256],
    ['screenBrightness', -1],
    ['screenBrightness', 0.5],
    ['reloadOnIdle', -1],
    ['reloadOnIdle', 86_401],
    ['startURL', 'fully://launcher'],
    ['screensaverWallpaperURL', 'javascript:alert(1)'],
    ['wifiKey', 'replacement-secret'],
    ['authPassword', 'replacement-secret'],
    ['keyboardShowSuggestions', false],
    ['injectJsCode', 'alert(1)'],
  ])('rejects non-curated or invalid setting input %#', async (key, value) => {
    const gateway = buildGateway();
    const service = new DeviceRemoteAdministrationService({ gateway });

    await expectInvalid(service.updateSetting('tablet', key, value), key === 'keepScreenOn'
      || EDITABLE_SETTING_KEYS.includes(key) ? 'value' : 'key');
    expect(gateway.writeSetting).not.toHaveBeenCalled();
  });

  it('logs mutation metadata without logging URLs, speech, overlay text, or setting values', async () => {
    const gateway = buildGateway();
    const logger = { info: vi.fn(), warn: vi.fn() };
    const service = new DeviceRemoteAdministrationService({ gateway, logger });

    await service.performAction('tablet', 'speak', { text: 'private words', locale: 'en-US' });
    await service.updateSetting('tablet', 'startURL', 'https://private.example/path');
    const logs = JSON.stringify(logger.info.mock.calls);

    expect(logs).toContain('tablet');
    expect(logs).toContain('speak');
    expect(logs).toContain('startURL');
    expect(logs).not.toContain('private words');
    expect(logs).not.toContain('private.example');
  });

  it('logs stable failure metadata and rethrows gateway errors', async () => {
    const error = Object.assign(new Error('private upstream detail'), { code: 'FKB_TIMEOUT' });
    const gateway = buildGateway({
      executeAction: vi.fn(async () => { throw error; }),
      writeSetting: vi.fn(async () => { throw error; }),
    });
    const logger = { info: vi.fn(), warn: vi.fn() };
    const service = new DeviceRemoteAdministrationService({ gateway, logger });

    await expect(service.performAction('tablet', 'screen-on')).rejects.toBe(error);
    await expect(service.updateSetting('tablet', 'keepScreenOn', true)).rejects.toBe(error);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('private upstream detail');
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });
});
