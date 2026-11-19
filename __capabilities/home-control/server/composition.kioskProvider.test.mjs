import { describe, it, expect, vi } from 'vitest';
import { createHomeAutomationAdapters } from './composition.mjs';

const logger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

describe('home-control kiosk adapter and the kiosk provider', () => {
  it('builds no kiosk adapter when no kiosk host is configured', () => {
    const adapters = createHomeAutomationAdapters({ logger: logger(), kiosk: { host: '' } });
    expect(adapters.kioskAdapter).toBeNull();
  });

  const kiosk = { host: 'fully.test', port: 2323, password: 'pw', daylightHost: 'https://daylight.test' };
  const httpClient = () => ({ get: vi.fn(async () => ({ ok: true, status: 200, data: { status: 'OK' } })) });

  it('builds the kiosk adapter with the http client it needs, and the adapter can reach the device', async () => {
    const http = httpClient();
    const adapters = createHomeAutomationAdapters({ logger: logger(), httpClient: http, kiosk });

    expect(adapters.kioskAdapter).not.toBeNull();
    expect(adapters.kioskAdapter.isConfigured()).toBe(true);
    await expect(adapters.kioskAdapter.sendCommand('screenOn')).resolves.toMatchObject({ ok: true });
    expect(http.get).toHaveBeenCalledTimes(1);
    expect(new URL(http.get.mock.calls[0][0]).host).toBe('fully.test:2323');
  });

  it('builds the tasker adapter with the same http client', () => {
    const adapters = createHomeAutomationAdapters({ logger: logger(), httpClient: httpClient(), tasker: { host: 'tasker.test', port: 1821 } });
    expect(adapters.taskerAdapter).not.toBeNull();
  });

  it('does not throw when a host is configured and no http client was given', () => {
    const log = logger();
    let adapters;
    expect(() => {
      adapters = createHomeAutomationAdapters({ logger: log, kiosk, tasker: { host: 'tasker.test', port: 1821 } });
    }).not.toThrow();
    expect(adapters.kioskAdapter).toBeNull();
    expect(adapters.taskerAdapter).toBeNull();
    expect(log.warn).toHaveBeenCalledWith('homeAutomation.kiosk.disabled', { reason: 'no http client' });
    expect(log.warn).toHaveBeenCalledWith('homeAutomation.tasker.disabled', { reason: 'no http client' });
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('pw');
  });

  it('does not point the Fully-only adapter at a device on another kiosk provider', () => {
    const log = logger();
    const adapters = createHomeAutomationAdapters({
      logger: log,
      kiosk: { provider: 'daylight-android', host: 'kiosk.test', port: 8780, password: 'pw', daylightHost: 'https://daylight.test' },
    });

    expect(adapters.kioskAdapter).toBeNull();
    expect(log.warn).toHaveBeenCalledWith('homeAutomation.kiosk.unsupportedProvider', { provider: 'daylight-android' });
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('pw');
  });
});
