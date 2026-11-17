// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { createServer } from 'node:http';
import { createArcadeBluetoothService } from './arcadeBluetooth.mjs';

const TOKEN = 'tok-super-secret';
const state = { ok: true, adapter: { supported: true, enabled: true, discovering: false }, devices: [], pairing: null, capabilities: { input: true } };

async function listen(handler) {
  const server = createServer(handler);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => server.close(r)) };
}

/** The old audio-bridge app: its own port, no token. */
async function audioBridge(calls) {
  return listen(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    calls.push({ url: req.url, method: req.method, body, token: req.headers['x-daylight-token'] ?? null, contentType: req.headers['content-type'] ?? null });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(req.method === 'GET' ? state : { ok: true, accepted: true }));
  });
}

/** The Android kiosk app's control API, as an axios-shaped client. */
function controlApi(respond = (method) => ({ status: 200, data: method === 'GET' ? state : { ok: true, accepted: true } })) {
  const calls = [];
  const handler = method => async (url, a, b) => {
    const config = method === 'POST' ? b : a;
    calls.push({ method, url, body: method === 'POST' ? a : undefined, token: config.headers['X-Daylight-Token'], timeout: config.timeout });
    return respond(method, url);
  };
  return { httpClient: { get: vi.fn(handler('GET')), post: vi.fn(handler('POST')), delete: vi.fn() }, calls };
}

const configService = { getHouseholdAuth: vi.fn(ref => (ref === 'daylight-android' ? { 'den-tv': { token: TOKEN } } : null)) };
const logger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() });
const daylightDevice = (extra = {}) => ({
  content_control: { provider: 'daylight-android', host: 'kiosk.test', port: 8780, auth_ref: 'daylight-android' },
  bluetooth_bridge: { pairing: { steps: ['Hold PAIR'] } },
  ...extra,
});

describe('controller pairing with one device of each kind', () => {
  it('sends the audio-bridge device to its own port with no token, and the Android kiosk device to its control port with one', async () => {
    const bridgeCalls = [];
    const bridge = await audioBridge(bridgeCalls);
    const control = controlApi();
    const log = logger();
    const service = createArcadeBluetoothService({
      devicesConfig: { devices: {
        'livingroom-tv': { content_control: { provider: 'fully-kiosk', host: 'fully.test' }, bluetooth_bridge: { url: bridge.url } },
        'den-tv': daylightDevice(),
      } },
      configService, httpClient: control.httpClient, logger: log,
    });
    try {
      // The audio-bridge device, exactly as before.
      expect(await service.state('livingroom-tv')).toEqual(state);
      await service.command('livingroom-tv', 'connect', { address: 'aa:bb:cc:dd:ee:ff', profile: 'input' });
      expect(bridgeCalls).toEqual([
        { url: '/bluetooth', method: 'GET', body: '', token: null, contentType: null },
        { url: '/bluetooth/connect', method: 'POST', body: '{"address":"AA:BB:CC:DD:EE:FF","profile":"input"}', token: null, contentType: 'application/json' },
      ]);
      expect(control.calls).toEqual([]);

      // The Android kiosk device.
      expect(await service.state('den-tv')).toEqual({ ...state, guide: { mode: null, steps: ['Hold PAIR'], troubleshoot: null } });
      expect(await service.command('den-tv', 'pairing', { address: 'aa:bb:cc:dd:ee:ff', accept: true, pin: '1234' })).toEqual({ ok: true, accepted: true });
      expect(control.calls).toEqual([
        { method: 'GET', url: 'http://kiosk.test:8780/bluetooth', body: undefined, token: TOKEN, timeout: 5000 },
        { method: 'POST', url: 'http://kiosk.test:8780/bluetooth/pairing', body: { address: 'AA:BB:CC:DD:EE:FF', accept: true, pin: '1234' }, token: TOKEN, timeout: 5000 },
      ]);
      expect(bridgeCalls).toHaveLength(2);

      // Neither the token nor the PIN is logged.
      const logged = JSON.stringify([log.info.mock.calls, log.warn.mock.calls, log.debug.mock.calls, log.error.mock.calls]);
      expect(logged).not.toContain(TOKEN);
      expect(logged).not.toContain('1234');
    } finally {
      await bridge.close();
    }
  });

  it('a daylight-android device opts in with a bluetooth_bridge block, as every device does', async () => {
    const control = controlApi();
    const service = createArcadeBluetoothService({
      devicesConfig: { 'den-tv': daylightDevice({ bluetooth_bridge: undefined }) },
      configService, httpClient: control.httpClient, logger: logger(),
    });
    await expect(service.state('den-tv')).rejects.toMatchObject({ status: 503 });
    expect(control.calls).toEqual([]);
  });

  it('ignores a bridge url on a daylight-android device and says so', async () => {
    const control = controlApi();
    const log = logger();
    const service = createArcadeBluetoothService({
      devicesConfig: { 'den-tv': daylightDevice({ bluetooth_bridge: { url: 'http://old-bridge.test:1' } }) },
      configService, httpClient: control.httpClient, logger: log,
    });
    await service.state('den-tv');
    expect(control.calls[0].url).toBe('http://kiosk.test:8780/bluetooth');
    expect(log.warn).toHaveBeenCalledWith('arcade.bluetooth.bridge_url_ignored', { deviceId: 'den-tv' });
  });

  it('answers 503 for a daylight-android device with no control address or no http client', async () => {
    const noHost = createArcadeBluetoothService({
      devicesConfig: { 'den-tv': daylightDevice({ content_control: { provider: 'daylight-android', auth_ref: 'daylight-android' } }) },
      configService, httpClient: controlApi().httpClient, logger: logger(),
    });
    await expect(noHost.state('den-tv')).rejects.toMatchObject({ status: 503 });
    const noClient = createArcadeBluetoothService({ devicesConfig: { 'den-tv': daylightDevice() }, configService, logger: logger() });
    await expect(noClient.state('den-tv')).rejects.toMatchObject({ status: 503 });
  });

  it.each([
    ['a rejected token', { status: 401, data: { ok: false, error: 'unauthorized' } }, { status: 502, code: 'auth_rejected' }],
    ['a wrong method', { status: 405, data: { ok: false, error: 'method_not_allowed' } }, { status: 501, code: 'unsupported' }],
    ['an action the device cannot do', { status: 501, data: { ok: false, error: 'unsupported', reason: 'gamepad mode' } }, { status: 501, code: 'unsupported' }],
    ['a 409', { status: 409, data: { ok: false, error: 'wake the controller', code: 'action_rejected' } }, { status: 409, code: 'bridge_rejected' }],
    ['an action_rejected body on a 200', { status: 200, data: { ok: false, error: 'pin 1234 refused', code: 'action_rejected' } }, { status: 409, code: 'bridge_rejected' }],
    ['HTML where JSON was expected', { status: 200, data: '<html></html>' }, { status: 502 }],
  ])('maps %s from the control API', async (_label, response, expected) => {
    const control = controlApi(() => response);
    const log = logger();
    const service = createArcadeBluetoothService({ devicesConfig: { 'den-tv': daylightDevice() }, configService, httpClient: control.httpClient, logger: log });
    const error = await service.command('den-tv', 'connect', { address: 'AA:BB:CC:DD:EE:FF', profile: 'input' }).catch(e => e);
    expect(error).toMatchObject(expected);
    // What the device said is neither returned nor logged: it can hold pairing secrets.
    expect(error.message).not.toMatch(/1234|wake the controller/);
    expect(JSON.stringify([log.warn.mock.calls, log.debug.mock.calls])).not.toMatch(/1234|wake the controller/);
  });

  it('refuses power before networking on either kind of device', async () => {
    const control = controlApi();
    const service = createArcadeBluetoothService({ devicesConfig: { 'den-tv': daylightDevice() }, configService, httpClient: control.httpClient, logger: logger() });
    await expect(service.command('den-tv', 'power', {})).rejects.toMatchObject({ status: 400 });
    expect(control.calls).toEqual([]);
  });

  it('builds one adapter per device and reuses it', async () => {
    const control = controlApi();
    const service = createArcadeBluetoothService({ devicesConfig: { 'den-tv': daylightDevice() }, configService, httpClient: control.httpClient, logger: logger() });
    await service.state('den-tv');
    await service.state('den-tv');
    expect(configService.getHouseholdAuth.mock.calls.filter(([ref]) => ref === 'daylight-android').length).toBeGreaterThan(0);
    expect(service.adapter('den-tv')).toBe(service.adapter('den-tv'));
  });
});
