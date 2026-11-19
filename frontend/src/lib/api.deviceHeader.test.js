// Tier 2, Task 2.2 — the header actually goes on the wire.
//
// `lib/api.mjs` sent only Content-Type and Authorization, so nothing in a
// backend log could say which of the house's screens made a request.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DaylightAPI, DaylightAPIText, DaylightStatusCheck } from './api.mjs';
import { getUser } from './auth.js';
import { getDeviceId, _resetDeviceIdForTests } from './deviceIdentity.js';

const HEADER = 'X-Daylight-Device';

function jsonResponse(body = { ok: true }) {
  return {
    ok: true,
    status: 200,
    redirected: false,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe('DaylightAPI sends X-Daylight-Device', () => {
  let fetchMock;

  beforeEach(() => {
    _resetDeviceIdForTests();
    window.localStorage.clear();
    fetchMock = vi.fn(async () => jsonResponse());
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const headersOf = () => fetchMock.mock.calls[0][1].headers;

  it('names the device on a GET', async () => {
    await DaylightAPI('api/v1/play/plex:694719');

    expect(headersOf()[HEADER]).toBe(getDeviceId());
  });

  it('names the device on a POST, alongside the body headers', async () => {
    await DaylightAPI('api/v1/play/log', { type: 'plex', assetId: '1', percent: 5 });

    expect(headersOf()).toMatchObject({
      'Content-Type': 'application/json',
      [HEADER]: getDeviceId(),
    });
  });

  it('keeps the Authorization header it already sent', async () => {
    window.localStorage.setItem('ds_token', 'a-token');

    await DaylightAPI('api/v1/anything');

    expect(headersOf()).toMatchObject({
      Authorization: 'Bearer a-token',
      [HEADER]: getDeviceId(),
    });
  });

  it('names the device on the text and status-check paths too', async () => {
    await DaylightAPIText('api/v1/proxy/media/stream/score.mxl');
    await DaylightStatusCheck('api/v1/health');

    for (const call of fetchMock.mock.calls) {
      expect(call[1].headers[HEADER]).toBe(getDeviceId());
    }
  });

  it('returns the final status after following a same-origin redirect with the device identity', async () => {
    const finalUrl = new URL('/api/v1/health', window.location.origin).href;
    fetchMock.mockResolvedValueOnce({ redirected: true, url: finalUrl, status: 200 });
    fetchMock.mockResolvedValueOnce({ redirected: false, status: 503 });

    await expect(DaylightStatusCheck('/api/v1/legacy-health/')).resolves.toBe(503);

    const expectedOptions = expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({ [HEADER]: getDeviceId() }),
    });
    expect(fetchMock.mock.calls).toEqual([
      [new URL('/api/v1/legacy-health', window.location.origin).href, expectedOptions],
      [finalUrl, expectedOptions],
    ]);
  });

  it('can read text and status without a stored token when storage is blocked', async () => {
    vi.stubGlobal('localStorage', undefined);
    expect(getUser()).toBeNull();
    await expect(DaylightAPIText('/document')).resolves.toBe('{"ok":true}');
    await expect(DaylightStatusCheck('/status')).resolves.toBe(200);
    for (const [, { headers }] of fetchMock.mock.calls) {
      expect(headers.Authorization).toBeUndefined();
      expect(headers[HEADER]).toBeTruthy();
    }
  });

  it('uses the returned status after a redirected write or external redirect', async () => {
    const finalUrl = new URL('/status', window.location.origin).href;
    fetchMock.mockResolvedValueOnce({ redirected: true, url: finalUrl, status: 201 });
    await expect(DaylightStatusCheck('/submit', { name: 'x' }, 'POST')).resolves.toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].body).toBe('{"name":"x"}');

    fetchMock.mockResolvedValueOnce({ redirected: true, url: 'https://external.invalid/document', status: 200 });
    await expect(DaylightStatusCheck('/external')).resolves.toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sends the same id on every call, so a run of requests is one device', async () => {
    await DaylightAPI('api/v1/one');
    await DaylightAPI('api/v1/two');

    const [first, second] = fetchMock.mock.calls.map((c) => c[1].headers[HEADER]);
    // Both assertions matter: without the first, two absent headers would be
    // "equal" and this would pass on code that sends nothing at all.
    expect(first).toBeTruthy();
    expect(first).toBe(second);
  });
});
