// Tier 2, Task 2.2 — the header actually goes on the wire.
//
// `lib/api.mjs` sent only Content-Type and Authorization, so nothing in a
// backend log could say which of the house's screens made a request.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DaylightAPI, DaylightAPIText, DaylightStatusCheck } from './api.mjs';
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
