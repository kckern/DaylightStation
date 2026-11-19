import { describe, it, expect, vi } from 'vitest';
import { createArcadeKioskClient } from './kioskClients.mjs';
import { FullyKioskRestClient } from '#adapters/devices/FullyKioskRestClient.mjs';
import { DaylightAndroidArcadeKioskClient } from '../adapters/devices/DaylightAndroidArcadeKioskClient.mjs';

const quiet = { debug() {}, info() {}, warn: vi.fn(), error() {} };
const TOKEN = 'tok-super-secret';

function http(response = { status: 200, data: { ok: true, foreground: 'net.example.kiosk' } }) {
  return { get: vi.fn(async () => response), post: vi.fn(async () => response), delete: vi.fn() };
}
const configService = {
  getHouseholdAuth: vi.fn(ref => (ref === 'fullykiosk' ? { password: 'pw' } : { 'livingroom-tv': { token: TOKEN } })),
};

describe('createArcadeKioskClient', () => {
  it('builds a Fully client for a fully-kiosk device, with the password from auth', async () => {
    const httpClient = http({ status: 200, data: { foregroundApp: 'x' } });
    const client = createArcadeKioskClient({
      deviceId: 'livingroom-tv',
      control: { provider: 'fully-kiosk', host: 'fully.test', port: 2323, auth_ref: 'fullykiosk' },
      configService, httpClient, logger: quiet,
    });

    expect(client).toBeInstanceOf(FullyKioskRestClient);
    await client.command('deviceInfo');
    const url = new URL(httpClient.get.mock.calls[0][0]);
    expect(url.host).toBe('fully.test:2323');
    expect(url.searchParams.get('password')).toBe('pw');
  });

  it('keeps building a Fully client when no provider is named, as before', () => {
    const client = createArcadeKioskClient({
      deviceId: 'livingroom-tv',
      control: { host: 'fully.test', port: 2323, password: 'inline' },
      configService, httpClient: http(), logger: quiet,
    });
    expect(client).toBeInstanceOf(FullyKioskRestClient);
  });

  it('builds the Android kiosk client for a daylight-android device, with the per-device token as a header', async () => {
    const httpClient = http();
    const client = createArcadeKioskClient({
      deviceId: 'livingroom-tv',
      control: { provider: 'daylight-android', host: 'kiosk.test', port: 8780, auth_ref: 'daylight-android' },
      configService, httpClient, logger: quiet,
    });

    expect(client).toBeInstanceOf(DaylightAndroidArcadeKioskClient);
    const result = await client.command('deviceInfo');
    expect(result.data.foregroundApp).toBe('net.example.kiosk');
    const [url, config] = httpClient.get.mock.calls[0];
    expect(url).toBe('http://kiosk.test:8780/lockdown');
    expect(config.headers['X-Daylight-Token']).toBe(TOKEN);
  });

  it('ignores an inline token and warns with the device id only', async () => {
    const httpClient = http();
    quiet.warn.mockClear();
    const client = createArcadeKioskClient({
      deviceId: 'livingroom-tv',
      control: { provider: 'daylight-android', host: 'kiosk.test', auth_ref: 'daylight-android', token: 'inline-token' },
      configService, httpClient, logger: quiet,
    });

    await client.command('deviceInfo');

    expect(httpClient.get.mock.calls[0][1].headers['X-Daylight-Token']).toBe(TOKEN);
    expect(quiet.warn).toHaveBeenCalledWith('arcade.kiosk.inline_token_ignored', { deviceId: 'livingroom-tv' });
    expect(JSON.stringify(quiet.warn.mock.calls)).not.toContain('inline-token');
  });

  it('returns null for a daylight-android device that cannot be reached by config', () => {
    expect(createArcadeKioskClient({
      deviceId: 'livingroom-tv',
      control: { provider: 'daylight-android', auth_ref: 'daylight-android' },
      configService, httpClient: http(), logger: quiet,
    })).toBeNull();
    expect(quiet.warn).toHaveBeenCalledWith('arcade.kiosk.unconfigured', { deviceId: 'livingroom-tv', provider: 'daylight-android' });
  });
});
