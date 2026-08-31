import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  daylightApi: vi.fn(),
  getDeviceId: vi.fn(() => 'admin-browser'),
}));

vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: mocks.daylightApi }));
vi.mock('../../../lib/deviceIdentity.js', () => ({ getDeviceId: mocks.getDeviceId }));

import fullyKioskAdminApi from './fullyKioskAdminApi.js';

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.daylightApi.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fullyKioskAdminApi', () => {
  it('uses the registered device route for JSON reads and semantic mutations', async () => {
    await fullyKioskAdminApi.status('kitchen/tablet');
    expect(mocks.daylightApi).toHaveBeenLastCalledWith(
      '/api/v1/admin/household/devices/kitchen%2Ftablet/fully-kiosk/status',
    );

    await fullyKioskAdminApi.settings('tablet');
    expect(mocks.daylightApi).toHaveBeenLastCalledWith(
      '/api/v1/admin/household/devices/tablet/fully-kiosk/settings',
    );

    await fullyKioskAdminApi.action('tablet', 'load/url', { url: 'https://example.test/' });
    expect(mocks.daylightApi).toHaveBeenLastCalledWith(
      '/api/v1/admin/household/devices/tablet/fully-kiosk/actions/load%2Furl',
      { url: 'https://example.test/' },
      'POST',
    );

    await fullyKioskAdminApi.updateSetting('tablet', 'setting/name', false);
    expect(mocks.daylightApi).toHaveBeenLastCalledWith(
      '/api/v1/admin/household/devices/tablet/fully-kiosk/settings/setting%2Fname',
      { value: false },
      'PUT',
    );
  });

  it('extracts the safe structured backend error from DaylightAPI failures', async () => {
    const upstream = Object.assign(
      new Error('Request failed - {"ok":false,"error":"Device is offline","code":"FKB_UNREACHABLE"}'),
      { status: 502 },
    );
    mocks.daylightApi.mockRejectedValueOnce(upstream);

    await expect(fullyKioskAdminApi.status('tablet')).rejects.toMatchObject({
      message: 'Device is offline',
      status: 502,
      code: 'FKB_UNREACHABLE',
    });
  });

  it('preserves ordinary DaylightAPI errors when no structured body is present', async () => {
    const upstream = Object.assign(new Error('Network unavailable'), { status: 0 });
    mocks.daylightApi.mockRejectedValueOnce(upstream);
    await expect(fullyKioskAdminApi.status('tablet')).rejects.toBe(upstream);
  });

  it('fetches screenshot blobs with bearer/device headers, abort signal, and capture timestamp', async () => {
    const blob = new Blob(['png'], { type: 'image/png' });
    const response = {
      ok: true,
      status: 200,
      blob: vi.fn(async () => blob),
      headers: { get: vi.fn(name => (name === 'X-Captured-At' ? '2026-08-31T12:00:00.000Z' : null)) },
    };
    const fetch = vi.fn(async () => response);
    vi.stubGlobal('fetch', fetch);
    localStorage.setItem('ds_token', 'admin-token');
    const controller = new AbortController();

    await expect(fullyKioskAdminApi.screenshot('tablet', { signal: controller.signal }))
      .resolves.toEqual({ blob, capturedAt: '2026-08-31T12:00:00.000Z' });
    expect(fetch).toHaveBeenCalledWith(
      `${window.location.origin}/api/v1/admin/household/devices/tablet/fully-kiosk/screenshot`,
      {
        signal: controller.signal,
        headers: {
          Authorization: 'Bearer admin-token',
          'X-Daylight-Device': 'admin-browser',
        },
      },
    );
  });

  it('omits an empty bearer token and falls back to a local capture timestamp', async () => {
    const response = {
      ok: true,
      status: 200,
      blob: vi.fn(async () => new Blob(['png'])),
      headers: { get: vi.fn(() => null) },
    };
    const fetch = vi.fn(async () => response);
    vi.stubGlobal('fetch', fetch);

    const result = await fullyKioskAdminApi.screenshot('tablet');
    expect(result.capturedAt).toEqual(expect.any(String));
    expect(fetch.mock.calls[0][1].headers).toEqual({ 'X-Daylight-Device': 'admin-browser' });
  });

  it('surfaces safe JSON screenshot errors and handles non-JSON failures', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 504,
        json: vi.fn(async () => ({ error: 'Screenshot timed out' })),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: vi.fn(async () => { throw new Error('not json'); }),
      }));

    await expect(fullyKioskAdminApi.screenshot('tablet')).rejects.toMatchObject({
      message: 'Screenshot timed out',
      status: 504,
    });
    await expect(fullyKioskAdminApi.screenshot('tablet')).rejects.toMatchObject({
      message: 'Screenshot failed (502)',
      status: 502,
    });
  });
});
