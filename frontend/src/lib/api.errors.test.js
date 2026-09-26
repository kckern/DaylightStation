// What a failed call throws. A proxy that answers 502 while the backend
// restarts sends an HTML page; that page used to become the error message
// every ErrorState printed.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DaylightAPI } from './api.mjs';

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

  it('caps a long plain-text body', async () => {
    fetchMock.mockResolvedValue(response({ status: 500, statusText: 'Internal Server Error', body: 'x'.repeat(5000) }));
    expect((await failure()).message.length).toBeLessThan(400);
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

  it('a 200 that is not JSON says so instead of a parser error', async () => {
    fetchMock.mockResolvedValue(response({ body: '<!doctype html><html></html>' }));
    const err = await failure();
    expect(err.message).toBe('Unreadable response (HTTP 200)');
    expect(err.status).toBe(200);
  });
});
