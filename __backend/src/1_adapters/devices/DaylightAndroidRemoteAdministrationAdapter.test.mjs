import { describe, expect, it, vi } from 'vitest';
import { DaylightAndroidRemoteAdministrationAdapter } from './DaylightAndroidRemoteAdministrationAdapter.mjs';

const TOKEN = 'tok-super-secret';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const deviceSource = {
  tablet: {
    name: 'Piano tablet',
    type: 'tablet',
    content_control: { provider: 'daylight-android', host: 'kiosk.test', port: 8780, auth_ref: 'daylight-android' },
  },
  'fully-panel': {
    content_control: { provider: 'fully-kiosk', host: 'fully.test', port: 2323, auth_ref: 'fkb' },
  },
  'no-auth': {
    content_control: { provider: 'daylight-android', host: 'kiosk.test' },
  },
  'no-token': {
    content_control: { provider: 'daylight-android', host: 'kiosk.test', auth_ref: 'daylight-android' },
  },
};

/** `table` maps "METHOD /route" to an axios-style response or a function of the request. */
function build(table = {}) {
  const calls = [];
  const respond = method => async (url, a, b) => {
    const parsed = new URL(url);
    const body = method === 'POST' ? a : undefined;
    const config = method === 'POST' ? b : a;
    calls.push({ method, route: parsed.pathname, query: Object.fromEntries(parsed.searchParams), body, config, url });
    const entry = table[`${method} ${parsed.pathname}`];
    const response = typeof entry === 'function' ? entry({ body }) : entry;
    return response ?? { status: 200, data: { ok: true } };
  };
  const httpClient = { get: vi.fn(respond('GET')), post: vi.fn(respond('POST')), delete: vi.fn(respond('DELETE')) };
  const resolveAuth = vi.fn(() => ({ tablet: { host: 'kiosk.test', token: TOKEN } }));
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const adapter = new DaylightAndroidRemoteAdministrationAdapter({
    readDevices: () => deviceSource,
    resolveAuth,
    httpClient,
    logger,
  });
  return { adapter, httpClient, resolveAuth, logger, calls };
}

const json = data => ({ status: 200, data: { ok: true, ...data } });
const lastCall = calls => calls[calls.length - 1];

describe('DaylightAndroidRemoteAdministrationAdapter', () => {
  it('requires its collaborators', () => {
    const httpClient = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
    expect(() => new DaylightAndroidRemoteAdministrationAdapter({ resolveAuth: () => ({}), httpClient })).toThrow(/readDevices/);
    expect(() => new DaylightAndroidRemoteAdministrationAdapter({ readDevices: () => ({}), httpClient })).toThrow(/resolveAuth/);
    expect(() => new DaylightAndroidRemoteAdministrationAdapter({ readDevices: () => ({}), resolveAuth: () => ({}) })).toThrow(/httpClient/);
  });

  describe('target resolution', () => {
    it.each([
      ['../etc', 'INVALID_DEVICE_ID'],
      ['missing', 'DEVICE_NOT_FOUND'],
      ['fully-panel', 'NOT_DAYLIGHT_ANDROID'],
      ['no-auth', 'DAYLIGHT_ANDROID_CONFIGURATION_ERROR'],
      ['no-token', 'DAYLIGHT_ANDROID_CONFIGURATION_ERROR'],
    ])('rejects %s with %s before any request', async (deviceId, code) => {
      const { adapter, calls } = build();
      await expect(adapter.readSettings(deviceId)).rejects.toMatchObject({ code });
      expect(calls).toHaveLength(0);
    });

    it('reads the token for the device id from the auth file and sends it as a header only', async () => {
      const { adapter, calls, resolveAuth, logger } = build({ 'GET /settings': json({ settings: [] }) });

      await adapter.readSettings('tablet');

      expect(resolveAuth).toHaveBeenCalledWith('daylight-android');
      expect(calls[0].url).toBe('http://kiosk.test:8780/settings');
      expect(calls[0].config.headers['X-Daylight-Token']).toBe(TOKEN);
      expect(JSON.stringify(logger.debug.mock.calls)).not.toContain(TOKEN);
    });
  });

  describe('executeAction', () => {
    it.each([
      ['screen-on', {}, '/screen', { on: true }],
      ['screen-off', {}, '/screen', { on: false }],
      ['set-brightness', { level: 120 }, '/screen/brightness', { level: 120 }],
      ['load-start-url', {}, '/kiosk/load-start', {}],
      ['load-url', { url: 'https://daylight.test/piano' }, '/kiosk/load', { url: 'https://daylight.test/piano' }],
      ['refresh', {}, '/kiosk/reload', {}],
      ['reset-webview', {}, '/kiosk/renderer/reset', {}],
      ['foreground', {}, '/kiosk/foreground', {}],
      ['restart-app', {}, '/kiosk/restart', {}],
      ['kiosk-lock', {}, '/lockdown/lock', {}],
      ['kiosk-unlock', {}, '/lockdown/unlock', {}],
      ['maintenance-enable', {}, '/lockdown/unlock', { forMs: 900_000 }],
      ['maintenance-disable', {}, '/lockdown/lock', {}],
      ['overlay-message', { text: 'Dinner' }, '/kiosk/overlay', { text: 'Dinner' }],
      ['set-volume', { level: 40 }, '/volume', { level: 40, stream: 3 }],
      ['speak', { text: 'Hello', locale: 'en-US' }, '/speak', { text: 'Hello', locale: 'en-US' }],
      ['speak', { text: 'Hello' }, '/speak', { text: 'Hello' }],
      ['launch-app', { package: 'org.example.player' }, '/launch', { package: 'org.example.player' }],
      ['reboot', {}, '/device/reboot', {}],
    ])('%s %j posts %s', async (action, params, route, body) => {
      const { adapter, calls } = build();

      await adapter.executeAction('tablet', action, params);

      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ method: 'POST', route });
      expect(calls[0].body).toEqual(body);
    });

    it('returns what the device reported', async () => {
      const { adapter } = build({ 'POST /screen': json({ screenOn: true }) });
      await expect(adapter.executeAction('tablet', 'screen-on')).resolves.toEqual({ ok: true, screenOn: true });
    });

    it('takes the maintenance window from device config when it is set', async () => {
      const { adapter, calls } = build();
      deviceSource.tablet.content_control.maintenance_ms = 60_000;
      try {
        await adapter.executeAction('tablet', 'maintenance-enable');
      } finally {
        delete deviceSource.tablet.content_control.maintenance_ms;
      }
      expect(calls[0].body).toEqual({ forMs: 60_000 });
    });

    it.each(['screensaver-start', 'screensaver-stop', 'self-destruct'])(
      'refuses %s as INVALID_ACTION without a request',
      async (action) => {
        const { adapter, calls } = build();
        await expect(adapter.executeAction('tablet', action)).rejects.toMatchObject({ code: 'INVALID_ACTION' });
        expect(calls).toHaveLength(0);
      },
    );

    it('gives a page load longer than the default request timeout', async () => {
      const { adapter, calls } = build();
      await adapter.executeAction('tablet', 'load-url', { url: 'https://daylight.test/' });
      expect(calls[0].config.timeout).toBeGreaterThan(20_000);
    });

    it.each([
      [{ status: 401, data: { ok: false, error: 'unauthorized' } }, 'DAYLIGHT_ANDROID_AUTH_REJECTED'],
      [{ status: 501, data: { ok: false, error: 'unsupported', reason: 'device owner required' } }, 'DAYLIGHT_ANDROID_UNSUPPORTED'],
      [{ status: 400, data: { ok: false, error: 'bad_request' } }, 'DAYLIGHT_ANDROID_COMMAND_REJECTED'],
      [{ status: 200, data: { ok: false, error: 'not_installed' } }, 'DAYLIGHT_ANDROID_COMMAND_REJECTED'],
      [{ status: 500, data: { ok: false, error: 'internal' } }, 'DAYLIGHT_ANDROID_COMMAND_REJECTED'],
      [{ status: 200, data: '<html></html>' }, 'DAYLIGHT_ANDROID_INVALID_RESPONSE'],
    ])('maps a device failure to a gateway error code', async (response, code) => {
      const { adapter } = build({ 'POST /device/reboot': response });
      await expect(adapter.executeAction('tablet', 'reboot')).rejects.toMatchObject({
        name: 'DeviceRemoteGatewayError', code,
      });
    });

    it.each([
      [Object.assign(new Error('timeout of 10000ms exceeded'), { code: 'ECONNABORTED' }), 'DAYLIGHT_ANDROID_TIMEOUT'],
      [Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }), 'DAYLIGHT_ANDROID_UNREACHABLE'],
    ])('maps a transport failure to a gateway error code', async (error, code) => {
      const { adapter, httpClient } = build();
      httpClient.post.mockRejectedValue(error);
      await expect(adapter.executeAction('tablet', 'refresh')).rejects.toMatchObject({ code });
    });

    it('error messages never carry the token', async () => {
      const { adapter, httpClient } = build();
      httpClient.post.mockRejectedValue(new Error(`connect ECONNREFUSED ${TOKEN}`));
      const error = await adapter.executeAction('tablet', 'refresh').catch(e => e);
      expect(error.message).not.toContain(TOKEN);
    });
  });

  describe('settings', () => {
    it('readSettings turns the settings list into a key/value map', async () => {
      const { adapter, calls } = build({
        'GET /settings': json({
          settings: [
            { key: 'webview.startUrl', type: 'string', value: 'https://daylight.test/piano', default: '', overridden: true },
            { key: 'webview.loadTimeoutSec', type: 'number', value: 20, default: 20, overridden: false },
            { key: 'debug.execEnabled', type: 'boolean', value: false, default: false, overridden: false },
          ],
        }),
      });

      await expect(adapter.readSettings('tablet')).resolves.toEqual({
        'webview.startUrl': 'https://daylight.test/piano',
        'webview.loadTimeoutSec': 20,
        'debug.execEnabled': false,
      });
      expect(calls[0]).toMatchObject({ method: 'GET', route: '/settings' });
    });

    it('readTypedSettings returns the device descriptors with normalised types', async () => {
      const { adapter } = build({
        'GET /settings': json({
          settings: [
            { key: 'webview.startUrl', type: 'string', value: 'https://daylight.test/piano', default: '', overridden: true },
            { key: 'webview.loadTimeoutSec', type: 'int', value: 20 },
            { key: 'debug.execEnabled', type: 'bool', value: false },
            { key: 'update.channel', type: 'enum', value: 'stable' },
            { type: 'string', value: 'no key' },
          ],
        }),
      });

      await expect(adapter.readTypedSettings('tablet')).resolves.toEqual([
        { key: 'webview.startUrl', type: 'string', value: 'https://daylight.test/piano' },
        { key: 'webview.loadTimeoutSec', type: 'number', value: 20 },
        { key: 'debug.execEnabled', type: 'boolean', value: false },
        { key: 'update.channel', type: 'enum', value: 'stable' },
      ]);
    });

    it('readSettings rejects a body without a settings list', async () => {
      const { adapter } = build({ 'GET /settings': json({ settings: 'nope' }) });
      await expect(adapter.readSettings('tablet')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    });

    it('writeSetting posts the key and value with its type kept', async () => {
      const { adapter, calls } = build({ 'POST /settings': ({ body }) => json(body) });

      await expect(adapter.writeSetting('tablet', 'debug.execEnabled', true))
        .resolves.toEqual({ ok: true, key: 'debug.execEnabled', value: true });
      await adapter.writeSetting('tablet', 'webview.loadTimeoutSec', 30);

      expect(calls.map(call => call.body)).toEqual([
        { key: 'debug.execEnabled', value: true },
        { key: 'webview.loadTimeoutSec', value: 30 },
      ]);
    });

    it('writeSetting surfaces an unknown setting as a rejected command', async () => {
      const { adapter } = build({ 'POST /settings': { status: 404, data: { ok: false, error: 'unknown_setting' } } });
      await expect(adapter.writeSetting('tablet', 'startURL', 'https://x.test/'))
        .rejects.toMatchObject({ code: 'DAYLIGHT_ANDROID_COMMAND_REJECTED' });
    });
  });

  describe('captureScreenshot', () => {
    it('returns the PNG the device sent', async () => {
      const { adapter, calls } = build({ 'GET /debug/screenshot': { status: 200, data: PNG, headers: { 'content-type': 'image/png' } } });

      const shot = await adapter.captureScreenshot('tablet');

      expect(lastCall(calls)).toMatchObject({ method: 'GET', route: '/debug/screenshot' });
      expect(lastCall(calls).config).toMatchObject({ responseType: 'arraybuffer', timeout: 20_000 });
      expect(shot.buffer.equals(PNG)).toBe(true);
      expect(shot.contentType).toBe('image/png');
      expect(Number.isNaN(Date.parse(shot.capturedAt))).toBe(false);
    });

    it('rejects bytes that are not a PNG', async () => {
      const { adapter } = build({ 'GET /debug/screenshot': { status: 200, data: Buffer.from('GIF89a not a png') } });
      await expect(adapter.captureScreenshot('tablet')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    });

    it('rejects an empty body', async () => {
      const { adapter } = build({ 'GET /debug/screenshot': { status: 200, data: Buffer.alloc(0) } });
      await expect(adapter.captureScreenshot('tablet')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    });
  });

  describe('readStatus', () => {
    const table = {
      'GET /kiosk/status': json({
        ready: true,
        currentUrl: 'https://daylight.test/piano',
        startUrl: 'https://daylight.test/piano',
        screenOn: true,
        foreground: 'net.example.kiosk',
        kioskInForeground: true,
        locked: true,
        rendererAlive: true,
        batteryLevel: 88,
        plugged: true,
        ramFreeMb: 512,
        ramTotalMb: 2048,
        wifiSsid: 'home',
        wifiSignalLevel: 4,
      }),
      'GET /status': json({ device: 'piano-tablet', payloadVersion: '1.4.0', shellVersionCode: 7, uptimeMs: 1000, capabilities: ['webview-host'] }),
      'GET /debug/info': json({ device: 'gta4lwifi', model: 'SM-T590', sdkInt: 29 }),
    };

    it('summarises the device under the names the admin console reads', async () => {
      const { adapter } = build(table);

      const status = await adapter.readStatus('tablet');

      expect(status.device).toEqual({ id: 'tablet', name: 'Piano tablet', type: 'tablet', address: 'kiosk.test:8780' });
      expect(status.companionApps).toEqual([]);
      expect(status.provider).toBe('daylight-android');
      expect(status.unsupportedActions).toEqual(['screensaver-start', 'screensaver-stop']);
      expect(status.summary).toMatchObject({
        deviceName: 'piano-tablet',
        model: 'SM-T590',
        appVersion: '1.4.0',
        currentUrl: 'https://daylight.test/piano',
        startUrl: 'https://daylight.test/piano',
        screenOn: true,
        batteryLevel: 88,
        plugged: true,
        ssid: 'home',
        wifiSignal: 4,
        ramFree: 512 * 1024 * 1024,
        ramTotal: 2048 * 1024 * 1024,
        kioskLocked: true,
        foregroundPackage: 'net.example.kiosk',
        screensaver: null,
        storageFree: null,
      });
      expect(status.details).toMatchObject({ ready: true, rendererAlive: true, payloadVersion: '1.4.0', sdkInt: 29 });
    });

    it('prefers the shell appVersion over the payload version', async () => {
      const { adapter } = build({
        ...table,
        'GET /status': json({ device: 'piano-tablet', appVersion: '2.1.0', payloadVersion: '1.4.0' }),
      });
      const status = await adapter.readStatus('tablet');
      expect(status.summary.appVersion).toBe('2.1.0');
    });

    it('still answers when only the kiosk status route does', async () => {
      const { adapter } = build({
        'GET /kiosk/status': table['GET /kiosk/status'],
        'GET /status': { status: 500, data: { ok: false, error: 'internal' } },
        'GET /debug/info': { status: 404, data: { ok: false, error: 'unknown_route' } },
      });
      const status = await adapter.readStatus('tablet');
      expect(status.summary).toMatchObject({ screenOn: true, appVersion: null, model: null });
    });

    it('fails when the kiosk status route fails', async () => {
      const { adapter } = build({ 'GET /kiosk/status': { status: 401, data: { ok: false, error: 'unauthorized' } } });
      await expect(adapter.readStatus('tablet')).rejects.toMatchObject({ code: 'DAYLIGHT_ANDROID_AUTH_REJECTED' });
    });

    it('blanks detail fields whose names look like credentials', async () => {
      const { adapter } = build({
        ...table,
        'GET /status': json({ device: 'piano-tablet', payloadVersion: '1.4.0', pairingToken: 'abc' }),
      });
      const status = await adapter.readStatus('tablet');
      expect(status.details.pairingToken).toBeNull();
    });
  });
});
