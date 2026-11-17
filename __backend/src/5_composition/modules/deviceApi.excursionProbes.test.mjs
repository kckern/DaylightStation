import { describe, it, expect, vi } from 'vitest';
import { createExcursionProbes } from './deviceApi.mjs';
import { AndroidForegroundProbe } from '#adapters/devices/AndroidForegroundProbe.mjs';
import { DaylightAndroidForegroundProbe } from '#adapters/devices/DaylightAndroidForegroundProbe.mjs';

const TOKEN = 'tok-super-secret';
const devices = {
  shield: { content_control: { provider: 'fully-kiosk', host: 'fully.test', fallback: { provider: 'adb', host: 'fully.test', port: 5555 } } },
  'shield-no-adb': { content_control: { provider: 'fully-kiosk', host: 'fully.test' } },
  tablet: { content_control: { provider: 'daylight-android', host: 'kiosk.test', port: 8780, auth_ref: 'daylight-android' } },
  'tablet-no-host': { content_control: { provider: 'daylight-android', auth_ref: 'daylight-android' } },
  pc: { content_control: { provider: 'websocket' } },
};

function build({ httpClient } = {}) {
  const http = httpClient === undefined
    ? { get: vi.fn(async () => ({ status: 200, data: { ok: true, foreground: 'x.y', kioskInForeground: true } })), post: vi.fn(), delete: vi.fn() }
    : httpClient;
  const configService = {
    getDeviceConfig: vi.fn(id => devices[id]),
    getHouseholdAuth: vi.fn(() => ({ tablet: { token: TOKEN } })),
  };
  const probeFor = createExcursionProbes({
    configService, httpClient: http, kioskPackage: 'de.ozerov.fully', logger: { debug() {}, info() {}, warn() {} },
  });
  return { probeFor, configService, http };
}

describe('excursion probes by provider', () => {
  it('gives a fully-kiosk device with ADB the ADB probe, as before', () => {
    expect(build().probeFor('shield')).toBeInstanceOf(AndroidForegroundProbe);
  });

  it.each(['shield-no-adb', 'pc', 'missing', 'tablet-no-host'])('gives %s no probe', (id) => {
    expect(build().probeFor(id)).toBeNull();
  });

  it('gives a daylight-android device a probe that asks the app, with the per-device token', async () => {
    const { probeFor, http } = build();
    const probe = probeFor('tablet');

    expect(probe).toBeInstanceOf(DaylightAndroidForegroundProbe);
    await expect(probe.foreground()).resolves.toEqual({ package: 'de.ozerov.fully', activity: '' });
    const [url, config] = http.get.mock.calls[0];
    expect(url).toBe('http://kiosk.test:8780/lockdown');
    expect(config.headers['X-Daylight-Token']).toBe(TOKEN);
  });

  it('ignores an inline token and warns with the device id only', async () => {
    const warn = vi.fn();
    const http = { get: vi.fn(async () => ({ status: 200, data: { ok: true, kioskInForeground: true } })), post: vi.fn(), delete: vi.fn() };
    const probeFor = createExcursionProbes({
      configService: {
        getDeviceConfig: () => ({ content_control: { provider: 'daylight-android', host: 'kiosk.test', auth_ref: 'daylight-android', token: 'inline-token' } }),
        getHouseholdAuth: () => ({ tablet: { token: TOKEN } }),
      },
      httpClient: http, logger: { warn, debug() {} },
    });

    await probeFor('tablet').foreground();

    expect(http.get.mock.calls[0][1].headers['X-Daylight-Token']).toBe(TOKEN);
    expect(warn).toHaveBeenCalledWith('device.excursion.inline_token_ignored', { deviceId: 'tablet' });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('inline-token');
  });

  it('gives a daylight-android device no probe when there is no http client', () => {
    expect(build({ httpClient: null }).probeFor('tablet')).toBeNull();
  });

  it('builds each probe once', () => {
    const { probeFor, configService } = build();
    expect(probeFor('tablet')).toBe(probeFor('tablet'));
    expect(configService.getDeviceConfig).toHaveBeenCalledTimes(1);
  });
});
