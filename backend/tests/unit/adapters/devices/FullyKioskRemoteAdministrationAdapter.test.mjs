import { describe, expect, it, vi } from 'vitest';
import { FullyKioskRestClient } from '#adapters/devices/FullyKioskRestClient.mjs';
import { FullyKioskRemoteAdministrationAdapter } from '#adapters/devices/FullyKioskRemoteAdministrationAdapter.mjs';

const deviceSource = {
  tablet: {
    name: 'Kitchen tablet',
    type: 'tablet',
    content_control: {
      provider: 'fully-kiosk',
      host: '10.0.0.50',
      port: 2323,
      auth_ref: 'fkb',
      companion_apps: ['org.example.player'],
    },
  },
};

function requestQuery(httpClient, call = 0) {
  return new URL(httpClient.get.mock.calls[call][0]).searchParams;
}

describe('FullyKioskRestClient', () => {
  function build(response = { status: 200, data: { status: 'OK' } }) {
    const logger = { debug: vi.fn(), warn: vi.fn() };
    const httpClient = { get: vi.fn(async () => response) };
    return {
      client: new FullyKioskRestClient(
        { host: '10.0.0.50', port: 2323, password: 'super-secret' },
        { httpClient, logger },
      ),
      httpClient,
      logger,
    };
  }

  it('encodes command parameters and never logs credential or parameter values', async () => {
    const { client, httpClient, logger } = build();

    await client.command('textToSpeech', { text: 'private announcement', locale: 'en-US' });

    const query = requestQuery(httpClient);
    expect(query.get('cmd')).toBe('textToSpeech');
    expect(query.get('password')).toBe('super-secret');
    expect(query.get('text')).toBe('private announcement');
    expect(query.get('locale')).toBe('en-US');
    expect(query.get('type')).toBe('json');
    expect(JSON.stringify(logger.debug.mock.calls)).not.toContain('super-secret');
    expect(JSON.stringify(logger.debug.mock.calls)).not.toContain('private announcement');
    expect(logger.debug).toHaveBeenCalledWith('fullykiosk.rest.request', expect.objectContaining({
      command: 'textToSpeech',
      host: '10.0.0.50',
      parameterNames: ['text', 'locale'],
    }));
  });

  it('parses JSON strings and leaves ordinary text responses available to the caller', async () => {
    const json = build({ status: 200, data: '{"status":"OK","value":3}' });
    await expect(json.client.command('getDeviceInfo')).resolves.toEqual({
      ok: true,
      data: { status: 'OK', value: 3 },
    });

    const text = build({ status: 200, data: 'OK' });
    await expect(text.client.command('getDeviceInfo')).resolves.toEqual({ ok: true, data: 'OK' });
  });

  it.each([
    [{ status: 200, data: { status: 'Error', statustext: 'Please login first' } }, 'AUTH_REJECTED'],
    [{ status: 200, data: { status: 'Error', statustext: 'Unknown command' } }, 'COMMAND_REJECTED'],
    [{ status: 200, data: '<html>Login and password required</html>' }, 'AUTH_REJECTED'],
    [{ status: 200, data: '<html>maintenance page</html>' }, 'INVALID_RESPONSE'],
    [{ status: 401, data: '' }, 'AUTH_REJECTED'],
    [{ status: 503, data: '' }, 'HTTP_ERROR'],
  ])('classifies rejected and malformed responses %#', async (response, code) => {
    const { client } = build(response);
    await expect(client.command('getDeviceInfo')).resolves.toMatchObject({ ok: false, code });
  });

  it.each([
    [Object.assign(new Error('timeout exceeded'), { code: 'ECONNABORTED' }), 'TIMEOUT'],
    [Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }), 'TIMEOUT'],
    [Object.assign(new Error('connect refused'), { code: 'ECONNREFUSED' }), 'UNREACHABLE'],
  ])('classifies transport errors without logging their raw messages', async (error, code) => {
    const logger = { debug: vi.fn(), warn: vi.fn() };
    const httpClient = { get: vi.fn(async () => { throw error; }) };
    const client = new FullyKioskRestClient(
      { host: '10.0.0.50', password: 'secret' },
      { httpClient, logger },
    );

    await expect(client.command('getDeviceInfo')).resolves.toMatchObject({ ok: false, code });
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(error.message);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('secret');
  });

  it('returns binary data with binary request options and detects HTML or JSON errors', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const valid = build({ status: 200, data: png, headers: { example: 'value' } });
    await expect(valid.client.command('getScreenshot', {}, {
      json: false,
      binary: true,
      timeout: 20_000,
    })).resolves.toEqual({ ok: true, data: png, headers: { example: 'value' } });
    expect(valid.httpClient.get).toHaveBeenCalledWith(expect.any(String), {
      timeout: 20_000,
      responseType: 'arraybuffer',
    });
    expect(requestQuery(valid.httpClient).has('type')).toBe(false);

    const html = build({ status: 200, data: Buffer.from('<html>Login password required</html>') });
    await expect(html.client.command('getScreenshot', {}, { binary: true }))
      .resolves.toMatchObject({ ok: false, code: 'AUTH_REJECTED' });

    const json = build({
      status: 200,
      data: Buffer.from(JSON.stringify({ status: 'Error', statustext: 'Not allowed' })),
    });
    await expect(json.client.command('getScreenshot', {}, { binary: true }))
      .resolves.toMatchObject({ ok: false, code: 'COMMAND_REJECTED' });
  });
});

describe('FullyKioskRemoteAdministrationAdapter', () => {
  function build({
    response = { status: 200, data: { status: 'OK' } },
    devices = deviceSource,
    auth = { password: 'secret' },
  } = {}) {
    const httpClient = {
      get: vi.fn(async (...args) => (typeof response === 'function' ? response(...args) : response)),
    };
    return {
      httpClient,
      adapter: new FullyKioskRemoteAdministrationAdapter({
        readDevices: () => devices,
        resolveAuth: () => auth,
        httpClient,
        logger: {},
      }),
    };
  }

  it('normalizes current and legacy status aliases and sanitizes details', async () => {
    const modern = build({ response: { status: 200, data: {
      deviceName: 'Tablet',
      manufacturer: 'Acme',
      model: 'Pixel C',
      version: '1.61.1',
      currentPageUrl: 'https://station.test/',
      screenOn: true,
      displayWidthPixels: 1920,
      displayHeightPixels: 1080,
      remoteAdminPassword: 'do-not-return',
      accessToken: 'do-not-return',
      wifiKey: 'do-not-return',
    } } });
    const result = await modern.adapter.readStatus('tablet');

    expect(result.device).toMatchObject({ id: 'tablet', name: 'Kitchen tablet', address: '10.0.0.50:2323' });
    expect(result.summary).toMatchObject({
      manufacturer: 'Acme',
      model: 'Pixel C',
      appVersion: '1.61.1',
      currentUrl: 'https://station.test/',
      screenOn: true,
      resolution: '1920 × 1080',
    });
    expect(result.details).toMatchObject({ remoteAdminPassword: null, accessToken: null, wifiKey: null });
    expect(result.companionApps).toEqual(['org.example.player']);

    const legacy = build({ response: { status: 200, data: {
      deviceModel: 'Legacy',
      appVersion: '1.40',
      currentUrl: 'https://legacy.test/',
      isScreenOn: false,
      displayWidth: 800,
      displayHeight: 600,
    } } });
    await expect(legacy.adapter.readStatus('tablet')).resolves.toMatchObject({
      summary: {
        model: 'Legacy',
        appVersion: '1.40',
        currentUrl: 'https://legacy.test/',
        screenOn: false,
        resolution: '800 × 600',
      },
    });
  });

  it.each([
    ['screen-on', {}, 'screenOn', {}],
    ['screen-off', {}, 'screenOff', {}],
    ['set-brightness', { level: 137 }, 'setScreenBrightness', { level: '137' }],
    ['load-start-url', {}, 'loadStartUrl', {}],
    ['load-url', { url: 'https://example.test/path?a=1' }, 'loadUrl', { url: 'https://example.test/path?a=1' }],
    ['refresh', {}, 'refreshTab', {}],
    ['reset-webview', {}, 'resetWebview', {}],
    ['foreground', {}, 'toForeground', {}],
    ['restart-app', {}, 'restartApp', {}],
    ['screensaver-start', {}, 'startScreensaver', {}],
    ['screensaver-stop', {}, 'stopScreensaver', {}],
    ['kiosk-lock', {}, 'lockKiosk', {}],
    ['kiosk-unlock', {}, 'unlockKiosk', {}],
    ['maintenance-enable', {}, 'enableLockedMode', {}],
    ['maintenance-disable', {}, 'disableLockedMode', {}],
    ['overlay-message', { text: 'Dinner' }, 'setOverlayMessage', { text: 'Dinner' }],
    ['set-volume', { level: 42 }, 'setAudioVolume', { level: '42', stream: '3' }],
    ['speak', { text: 'Hello', locale: 'en-US' }, 'textToSpeech', { text: 'Hello', locale: 'en-US' }],
    ['launch-app', { package: 'org.example.player' }, 'startApplication', { package: 'org.example.player' }],
    ['reboot', {}, 'rebootDevice', {}],
  ])('maps %s to the vendor command and expected parameters', async (action, params, command, expectedParams) => {
    const { adapter, httpClient } = build();
    await adapter.executeAction('tablet', action, params);

    const query = requestQuery(httpClient);
    expect(query.get('cmd')).toBe(command);
    for (const [key, value] of Object.entries(expectedParams)) expect(query.get(key)).toBe(value);
  });

  it('reads settings and selects the boolean or string vendor setter by normalized value', async () => {
    const responses = [
      { status: 200, data: { keepScreenOn: true } },
      { status: 200, data: { status: 'OK' } },
      { status: 200, data: { status: 'OK' } },
    ];
    const { adapter, httpClient } = build({ response: () => responses.shift() });

    await expect(adapter.readSettings('tablet')).resolves.toEqual({ keepScreenOn: true });
    await adapter.writeSetting('tablet', 'keepScreenOn', false);
    await adapter.writeSetting('tablet', 'screenBrightness', 120);

    expect(requestQuery(httpClient, 0).get('cmd')).toBe('listSettings');
    expect(requestQuery(httpClient, 1).get('cmd')).toBe('setBooleanSetting');
    expect(Object.fromEntries(requestQuery(httpClient, 1))).toMatchObject({
      key: 'keepScreenOn',
      value: 'false',
    });
    expect(requestQuery(httpClient, 2).get('cmd')).toBe('setStringSetting');
    expect(Object.fromEntries(requestQuery(httpClient, 2))).toMatchObject({
      key: 'screenBrightness',
      value: '120',
    });
  });

  it('returns only real PNG screenshots', async () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('data'),
    ]);
    const valid = build({ response: { status: 200, data: png } });
    await expect(valid.adapter.captureScreenshot('tablet')).resolves.toMatchObject({
      buffer: png,
      contentType: 'image/png',
      capturedAt: expect.any(String),
    });
    expect(requestQuery(valid.httpClient).get('cmd')).toBe('getScreenshot');
    expect(requestQuery(valid.httpClient).has('type')).toBe(false);

    const invalid = build({ response: { status: 200, data: Buffer.from('not a png') } });
    await expect(invalid.adapter.captureScreenshot('tablet'))
      .rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it.each([
    ['bad/id', deviceSource, { password: 'secret' }, 'INVALID_DEVICE_ID'],
    ['missing', deviceSource, { password: 'secret' }, 'DEVICE_NOT_FOUND'],
    ['tablet', { tablet: { content_control: { provider: 'chromecast' } } }, { password: 'secret' }, 'NOT_FULLY_KIOSK'],
    ['tablet', { tablet: { content_control: { provider: 'fully-kiosk', auth_ref: 'fkb' } } }, { password: 'secret' }, 'FKB_CONFIGURATION_ERROR'],
    ['tablet', { tablet: { content_control: { provider: 'fully-kiosk', host: '10.0.0.50' } } }, { password: 'secret' }, 'FKB_CONFIGURATION_ERROR'],
    ['tablet', deviceSource, {}, 'FKB_CONFIGURATION_ERROR'],
  ])('rejects invalid registry/auth target %# before making a request', async (deviceId, devices, auth, code) => {
    const { adapter, httpClient } = build({ devices, auth });
    await expect(adapter.readStatus(deviceId)).rejects.toMatchObject({ code });
    expect(httpClient.get).not.toHaveBeenCalled();
  });

  it('rejects arbitrary actions at the adapter boundary', async () => {
    const { adapter, httpClient } = build();
    await expect(adapter.executeAction('tablet', 'inject-js', { code: 'alert(1)' }))
      .rejects.toMatchObject({ code: 'INVALID_ACTION' });
    expect(httpClient.get).not.toHaveBeenCalled();
  });

  it('maps upstream errors to stable gateway codes and treats a dispatched reboot disconnect as accepted', async () => {
    const rejected = build({ response: {
      status: 200,
      data: { status: 'Error', statustext: 'Please login first' },
    } });
    await expect(rejected.adapter.readStatus('tablet'))
      .rejects.toMatchObject({ code: 'FKB_AUTH_REJECTED' });

    const dropped = build({ response: async () => {
      throw Object.assign(new Error('socket closed'), { code: 'ECONNRESET' });
    } });
    await expect(dropped.adapter.executeAction('tablet', 'reboot'))
      .resolves.toMatchObject({ accepted: true });
  });
});
