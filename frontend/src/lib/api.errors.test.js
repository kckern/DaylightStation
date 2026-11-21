// What a failed call throws. A proxy that answers 502 while the backend
// restarts sends an HTML page; that page used to become the error message
// every ErrorState printed.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DaylightAPI, daylightApiResponse } from './api.mjs';

const response = ({ status = 200, statusText = 'OK', body = '', json } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText,
  redirected: false,
  text: async () => body,
  json: json || (async () => JSON.parse(body)),
});

const NGINX_502 = '<html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<body>\r\n<center><h1>502 Bad Gateway</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>';

describe('DaylightAPI failures', () => {
  let fetchMock;
  beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); });
  afterEach(() => { vi.unstubAllGlobals(); });
  const failure = async () => DaylightAPI('api/v1/health/day?date=2026-09-25').then(() => null, err => err);

  it('a proxy 502 page is transient and never lands in the message', async () => {
    fetchMock.mockResolvedValue(response({ status: 502, statusText: 'Bad Gateway', body: NGINX_502 }));
    const err = await failure();
    expect(err.message).toBe('HTTP 502: Bad Gateway');
    expect(err.status).toBe(502);
    expect(err.transient).toBe(true);
  });

  it.each([503, 504])('%i is transient', async status => {
    fetchMock.mockResolvedValue(response({ status, statusText: 'Unavailable', body: '' }));
    expect((await failure()).transient).toBe(true);
  });

  it('keeps a JSON error body in the message, where callers parse it', async () => {
    fetchMock.mockResolvedValue(response({ status: 409, statusText: 'Conflict', body: '{"error":"stale revision"}' }));
    const err = await failure();
    expect(err.message).toBe('HTTP 409: Conflict - {"error":"stale revision"}');
    expect(err.transient).toBe(false);
  });

  it('attaches a JSON error body as `body`, leaving the message as it was', async () => {
    fetchMock.mockResolvedValue(response({ status: 402, statusText: 'Payment Required', body: '{"code":"PASS_UNAFFORDABLE","shortfall":2}' }));
    const err = await failure();
    expect(err.body).toEqual({ code: 'PASS_UNAFFORDABLE', shortfall: 2 });
    expect(err.message).toBe('HTTP 402: Payment Required - {"code":"PASS_UNAFFORDABLE","shortfall":2}');
  });

  it('leaves a large JSON body off `error.body`, so a logged error stays small', async () => {
    const big = JSON.stringify({ code: 'X', detail: 'y'.repeat(5000) });
    fetchMock.mockResolvedValue(response({ status: 400, statusText: 'Bad Request', body: big }));
    expect((await failure()).body).toBeUndefined();
  });

  it('leaves `body` unset when the error body is not JSON', async () => {
    fetchMock.mockResolvedValue(response({ status: 502, statusText: 'Bad Gateway', body: NGINX_502 }));
    expect((await failure()).body).toBeUndefined();
    fetchMock.mockResolvedValue(response({ status: 500, statusText: 'Internal Server Error', body: 'plain words' }));
    expect((await failure()).body).toBeUndefined();
  });

  it('caps a long plain-text body', async () => {
    fetchMock.mockResolvedValue(response({ status: 500, statusText: 'Internal Server Error', body: 'x'.repeat(5000) }));
    expect((await failure()).message.length).toBeLessThan(400);
  });

  it('refuses invalid request bodies before fetch without claiming a transient failure', async () => {
    const data = { value: 1n };
    const error = await DaylightAPI('api/v1/example', data, 'POST').catch(err => err);
    expect(error).toBeInstanceOf(TypeError);
    expect(error.transient).toBeUndefined();
    await expect(daylightApiResponse('api/v1/example', { method: 'POST', data })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends a cookie-authenticated request when local storage is unavailable', async () => {
    vi.stubGlobal('localStorage', { getItem() { throw new DOMException('Denied', 'SecurityError'); } });
    const reply = response({ status: 409 });
    fetchMock.mockResolvedValue(reply);
    expect(await daylightApiResponse('/api/v1/example')).toBe(reply);
    const { headers } = fetchMock.mock.calls[0][1];
    expect(headers.Authorization).toBeUndefined();
    expect(headers['X-Daylight-Device']).toBeTruthy();
  });

  it('a dropped connection is transient', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const err = await failure();
    expect(err.transient).toBe(true);
    expect(err.message).toBe('Network error: Failed to fetch');
  });

  it('an abort stays an abort', async () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError');
    fetchMock.mockRejectedValue(abort);
    expect(await failure()).toBe(abort);
  });

  it.each([200, 409])('preserves cancellation while reading the HTTP %i response body', async status => {
    const controller = new AbortController();
    const { signal } = controller;
    const abort = new DOMException('The operation was aborted.', 'AbortError');
    const body = new ReadableStream({
      start(stream) {
        stream.enqueue(new TextEncoder().encode('{"unfinished":'));
        signal.addEventListener('abort', () => stream.error(signal.reason), { once: true });
      },
    });
    const reply = new Response(body, { status });
    fetchMock.mockResolvedValue(reply);

    const request = DaylightAPI('api/v1/example', {}, 'GET', { signal });
    const canceled = expect(request).rejects.toBe(abort);
    await expect.poll(() => reply.bodyUsed).toBe(true);
    controller.abort(abort);
    await canceled;
  });

  it('a 200 that is not JSON says so instead of a parser error', async () => {
    fetchMock.mockResolvedValue(response({ body: '<!doctype html><html></html>' }));
    const err = await failure();
    expect(err.message).toBe('Unreadable response (HTTP 200)');
    expect(err.status).toBe(200);
  });
});
