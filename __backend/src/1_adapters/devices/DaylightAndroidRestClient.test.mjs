import { describe, expect, it, vi } from 'vitest';
import { DaylightAndroidRestClient } from './DaylightAndroidRestClient.mjs';

const TOKEN = 'tok-super-secret';

function build(response = { status: 200, data: { ok: true } }) {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const respond = async () => (typeof response === 'function' ? response() : response);
  const httpClient = { get: vi.fn(respond), post: vi.fn(respond), delete: vi.fn(respond) };
  const client = new DaylightAndroidRestClient(
    { host: 'kiosk.test', port: 8780, token: TOKEN },
    { httpClient, logger },
  );
  return { client, httpClient, logger };
}

const logged = logger => JSON.stringify([
  logger.debug.mock.calls, logger.info.mock.calls, logger.warn.mock.calls, logger.error.mock.calls,
]);

describe('DaylightAndroidRestClient', () => {
  it('requires a host and an http client that can get, post and delete', () => {
    const httpClient = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
    expect(() => new DaylightAndroidRestClient({ token: TOKEN }, { httpClient })).toThrow(/host/);
    expect(() => new DaylightAndroidRestClient({ host: 'h' }, { httpClient: { get: vi.fn() } }))
      .toThrow(/httpClient/);
  });

  it('defaults the control port to 8780', async () => {
    const httpClient = { get: vi.fn(async () => ({ status: 200, data: { ok: true } })), post: vi.fn(), delete: vi.fn() };
    const client = new DaylightAndroidRestClient({ host: 'kiosk.test', token: TOKEN }, { httpClient });
    await client.get('/status');
    expect(httpClient.get.mock.calls[0][0]).toBe('http://kiosk.test:8780/status');
  });

  it('GETs a route with the token in the header and nowhere else', async () => {
    const { client, httpClient, logger } = build({ status: 200, data: { ok: true, ready: true } });

    const result = await client.get('/kiosk/status');

    expect(result).toEqual({ ok: true, data: { ok: true, ready: true } });
    const [url, config] = httpClient.get.mock.calls[0];
    expect(url).toBe('http://kiosk.test:8780/kiosk/status');
    expect(url).not.toContain(TOKEN);
    expect(config.headers['X-Daylight-Token']).toBe(TOKEN);
    expect(config.timeout).toBe(10_000);
    expect(config.validateStatus(500)).toBe(true);
    expect(logged(logger)).not.toContain(TOKEN);
  });

  it('encodes query parameters and skips empty ones', async () => {
    const { client, httpClient } = build();
    await client.get('/volume', { query: { stream: 3, unused: undefined, none: null } });
    expect(httpClient.get.mock.calls[0][0]).toBe('http://kiosk.test:8780/volume?stream=3');
  });

  it('POSTs a JSON body and logs body keys, never body values', async () => {
    const { client, httpClient, logger } = build({ status: 200, data: { ok: true, queued: true } });

    const result = await client.post('/speak', { text: 'private announcement', locale: 'en-US' });

    expect(result.ok).toBe(true);
    const [url, body, config] = httpClient.post.mock.calls[0];
    expect(url).toBe('http://kiosk.test:8780/speak');
    expect(body).toEqual({ text: 'private announcement', locale: 'en-US' });
    expect(config.headers).toMatchObject({
      'X-Daylight-Token': TOKEN,
      'Content-Type': 'application/json',
    });
    expect(logged(logger)).not.toContain('private announcement');
    expect(logged(logger)).not.toContain(TOKEN);
    expect(logger.debug).toHaveBeenCalledWith('daylightandroid.rest.request', expect.objectContaining({
      method: 'POST',
      route: '/speak',
      host: 'kiosk.test',
      bodyKeys: ['text', 'locale'],
    }));
  });

  it('POSTs an empty JSON object when no body is given', async () => {
    const { client, httpClient } = build();
    await client.post('/kiosk/foreground');
    expect(httpClient.post.mock.calls[0][1]).toEqual({});
  });

  it('DELETEs a route with a query and logs the query keys only', async () => {
    const { client, httpClient, logger } = build({ status: 200, data: { ok: true, key: 'webview.startUrl', value: 'x' } });

    const result = await client.delete('/settings', { query: { key: 'webview.startUrl' } });

    expect(result.ok).toBe(true);
    const [url, config] = httpClient.delete.mock.calls[0];
    expect(url).toBe('http://kiosk.test:8780/settings?key=webview.startUrl');
    expect(config.headers['X-Daylight-Token']).toBe(TOKEN);
    expect(logged(logger)).not.toContain('webview.startUrl');
    expect(logger.debug).toHaveBeenCalledWith('daylightandroid.rest.request', expect.objectContaining({
      method: 'DELETE', queryKeys: ['key'],
    }));
  });

  it('parses a JSON string body', async () => {
    const { client } = build({ status: 200, data: '{"ok":true,"level":40}' });
    await expect(client.get('/volume')).resolves.toEqual({ ok: true, data: { ok: true, level: 40 } });
  });

  it.each([
    [401, { ok: false, error: 'unauthorized' }, 'AUTH_REJECTED'],
    [501, { ok: false, error: 'unsupported', reason: 'device owner required' }, 'UNSUPPORTED'],
    [404, { ok: false, error: 'unknown_route' }, 'COMMAND_REJECTED'],
    [400, { ok: false, error: 'bad_request' }, 'COMMAND_REJECTED'],
    [405, { ok: false, error: 'method_not_allowed' }, 'COMMAND_REJECTED'],
    [500, { ok: false, error: 'internal' }, 'HTTP_ERROR'],
    [503, 'Service Unavailable', 'HTTP_ERROR'],
  ])('maps HTTP %i to %s', async (status, data, code) => {
    const { client, logger } = build({ status, data });
    const result = await client.post('/device/reboot');
    expect(result.ok).toBe(false);
    expect(result.code).toBe(code);
    expect(result.status).toBe(status);
    expect(typeof result.error).toBe('string');
    expect(logger.warn).toHaveBeenCalledWith('daylightandroid.rest.response', expect.objectContaining({
      route: '/device/reboot', ok: false, code, status,
    }));
  });

  it('carries what the device said in the error text', async () => {
    const { client } = build({ status: 501, data: { ok: false, error: 'unsupported', reason: 'device owner required' } });
    const result = await client.post('/device/reboot');
    expect(result.error).toContain('unsupported');
    expect(result.error).toContain('device owner required');
    expect(result.deviceError).toBe('unsupported');
  });

  it('passes on the body `code` of a refusal', async () => {
    const { client } = build({ status: 409, data: { ok: false, error: 'wake the controller', code: 'action_rejected' } });
    await expect(client.post('/bluetooth/connect', {})).resolves.toMatchObject({
      ok: false, code: 'COMMAND_REJECTED', status: 409, deviceCode: 'action_rejected',
    });
  });

  it('can be told to keep what the device said out of its logs', async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const httpClient = { get: vi.fn(), post: vi.fn(async () => ({ status: 409, data: { ok: false, error: 'pin 1234 refused', reason: 'try 0000' } })), delete: vi.fn() };
    const client = new DaylightAndroidRestClient({ host: 'kiosk.test', token: TOKEN, logDeviceText: false }, { httpClient, logger });

    const result = await client.post('/bluetooth/pairing', { pin: '1234' });

    expect(result).toMatchObject({ ok: false, code: 'COMMAND_REJECTED', status: 409 });
    expect(logged(logger)).not.toMatch(/1234|0000/);
    expect(logger.warn).toHaveBeenCalledWith('daylightandroid.rest.response', expect.objectContaining({ route: '/bluetooth/pairing', code: 'COMMAND_REJECTED', status: 409 }));
  });

  it('maps a 2xx body with ok:false to COMMAND_REJECTED', async () => {
    const { client } = build({ status: 200, data: { ok: false, error: 'not_installed' } });
    const result = await client.post('/launch', { package: 'org.example.app' });
    expect(result).toMatchObject({ ok: false, code: 'COMMAND_REJECTED', deviceError: 'not_installed' });
  });

  it.each([
    ['an HTML page', '<html><body>hello</body></html>'],
    ['plain text', 'OK'],
    ['an array', [1, 2]],
    ['an object with no ok flag', { ready: true }],
    ['nothing', undefined],
  ])('maps %s where JSON was expected to INVALID_RESPONSE', async (_label, data) => {
    const { client } = build({ status: 200, data });
    const result = await client.get('/kiosk/status');
    expect(result).toMatchObject({ ok: false, code: 'INVALID_RESPONSE' });
  });

  it.each([
    [Object.assign(new Error('timeout of 10000ms exceeded'), { code: 'ECONNABORTED' }), 'TIMEOUT'],
    [Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }), 'TIMEOUT'],
    [Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }), 'UNREACHABLE'],
    [Object.assign(new Error('connect EHOSTUNREACH'), { code: 'EHOSTUNREACH' }), 'UNREACHABLE'],
  ])('maps a thrown transport error to its code', async (error, code) => {
    const { client } = build(() => { throw error; });
    const result = await client.get('/status');
    expect(result).toMatchObject({ ok: false, code });
  });

  it.each([
    ['ECONNREFUSED', true], ['EHOSTUNREACH', true], ['ENETUNREACH', true], ['ENOTFOUND', true], ['EAI_AGAIN', true],
    ['ECONNRESET', false], ['EPIPE', false], ['ECONNABORTED', false],
  ])('says whether %s means the request never reached the device (%s)', async (code, neverSent) => {
    const { client } = build(() => { throw Object.assign(new Error(`transport ${code}`), { code }); });
    const result = await client.post('/device/reboot');
    expect(result.ok).toBe(false);
    expect(result.neverSent === true).toBe(neverSent);
  });

  it('maps a thrown error that carries an HTTP response by its status', async () => {
    const error = Object.assign(new Error('Request failed with status code 401'), {
      response: { status: 401, data: { ok: false, error: 'unauthorized' } },
    });
    const { client } = build(() => { throw error; });
    await expect(client.get('/status')).resolves.toMatchObject({ ok: false, code: 'AUTH_REJECTED' });
  });

  it('never repeats the token when a transport error message echoes request config', async () => {
    const error = new Error(`connect ECONNREFUSED headers X-Daylight-Token: ${TOKEN}`);
    const { client, logger } = build(() => { throw error; });
    const result = await client.get('/status');
    expect(result.error).not.toContain(TOKEN);
    expect(logged(logger)).not.toContain(TOKEN);
  });

  describe('binary responses', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

    it('asks for an arraybuffer and returns a Buffer', async () => {
      const { client, httpClient } = build({ status: 200, data: png.buffer.slice(png.byteOffset, png.byteOffset + png.length), headers: { 'content-type': 'image/png' } });

      const result = await client.get('/debug/screenshot', { binary: true, timeout: 20_000 });

      expect(httpClient.get.mock.calls[0][1]).toMatchObject({ responseType: 'arraybuffer', timeout: 20_000 });
      expect(result.ok).toBe(true);
      expect(Buffer.isBuffer(result.data)).toBe(true);
      expect(result.data.equals(png)).toBe(true);
      expect(result.headers).toEqual({ 'content-type': 'image/png' });
    });

    it('maps an error status with a JSON body carried as bytes', async () => {
      const body = Buffer.from(JSON.stringify({ ok: false, error: 'unauthorized' }));
      const { client } = build({ status: 401, data: body });
      const result = await client.get('/debug/screenshot', { binary: true });
      expect(result).toMatchObject({ ok: false, code: 'AUTH_REJECTED', deviceError: 'unauthorized' });
    });

    it('maps a 2xx JSON refusal carried as bytes to COMMAND_REJECTED', async () => {
      const body = Buffer.from(JSON.stringify({ ok: false, error: 'capture_failed' }));
      const { client } = build({ status: 200, data: body });
      const result = await client.get('/debug/screenshot', { binary: true });
      expect(result).toMatchObject({ ok: false, code: 'COMMAND_REJECTED', deviceError: 'capture_failed' });
    });
  });
});
