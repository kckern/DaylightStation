import { describe, it, expect, vi } from 'vitest';
import { createHomeAutomationAdapters } from './composition.mjs';

const logger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

describe('home-control kiosk adapter and the kiosk provider', () => {
  it('builds no kiosk adapter when no kiosk host is configured', () => {
    const adapters = createHomeAutomationAdapters({ logger: logger(), kiosk: { host: '' } });
    expect(adapters.kioskAdapter).toBeNull();
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
