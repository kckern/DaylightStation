import { jest } from '@jest/globals';
import { FullyKioskContentAdapter } from '#adapters/devices/FullyKioskContentAdapter.mjs';

function makeLogger() {
  return { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

// Build a mock httpClient where each FKB `cmd=X` returns a scripted response.
function makeHttpClient(handler) {
  return {
    get: jest.fn(async (url) => {
      const match = url.match(/\bcmd=([^&]+)/);
      const cmd = match ? match[1] : null;
      return handler(cmd, url);
    })
  };
}

describe('FullyKioskContentAdapter.load verification', () => {
  test('returns ok:true when currentUrl matches expected after loadURL', async () => {
    const logger = makeLogger();
    let infoCalls = 0;
    const httpClient = makeHttpClient((cmd) => {
      if (cmd === 'loadURL') return { status: 200, data: { status: 'OK' } };
      if (cmd === 'deviceInfo' || cmd === 'getDeviceInfo') {
        infoCalls++;
        return {
          status: 200,
          data: {
            // Adapter builds query via URLSearchParams which encodes ':' as '%3A'.
            currentUrl: 'https://example.com/screen/living-room?queue=plex%3A1'
          }
        };
      }
      return { status: 200, data: {} };
    });
    const adapter = new FullyKioskContentAdapter(
      { host: '10.0.0.11', port: 2323, password: 'x', daylightHost: 'https://example.com' },
      { httpClient, logger }
    );

    const result = await adapter.load('/screen/living-room', { queue: 'plex:1' });

    expect(result.ok).toBe(true);
    expect(result.verified).toBe(true);
    expect(infoCalls).toBeGreaterThanOrEqual(1);
  });

  test('matches when sent URL uses %3A but FKB returns decoded :', async () => {
    const logger = makeLogger();
    const httpClient = makeHttpClient((cmd) => {
      if (cmd === 'loadURL') return { status: 200, data: { status: 'OK' } };
      if (cmd === 'deviceInfo' || cmd === 'getDeviceInfo') {
        // FKB returns decoded ":"
        return {
          status: 200,
          data: { currentUrl: 'https://example.com/screen/living-room?queue=plex:1' }
        };
      }
      return { status: 200, data: {} };
    });
    const adapter = new FullyKioskContentAdapter(
      { host: '10.0.0.11', port: 2323, password: 'x', daylightHost: 'https://example.com' },
      { httpClient, logger }
    );
    const result = await adapter.load('/screen/living-room', { queue: 'plex:1' });
    // Adapter sent queue=plex%3A1; FKB returned queue=plex:1 — normalize via decodeURIComponent
    expect(result.ok).toBe(true);
    expect(result.verified).toBe(true);
  });

  test('retries loadURL on url mismatch and succeeds on a later attempt', async () => {
    jest.useFakeTimers();
    const logger = makeLogger();
    let attempt = 0;
    const httpClient = makeHttpClient((cmd) => {
      if (cmd === 'loadURL') {
        attempt++;
        return { status: 200, data: { status: 'OK' } };
      }
      if (cmd === 'deviceInfo' || cmd === 'getDeviceInfo') {
        // Attempts 1-2: wrong page. Attempt 3: correct.
        if (attempt < 3) {
          return { status: 200, data: { currentUrl: 'https://example.com/screen/office' } };
        }
        return { status: 200, data: { currentUrl: 'https://example.com/screen/living-room?queue=plex:1' } };
      }
      return { status: 200, data: {} };
    });
    const adapter = new FullyKioskContentAdapter(
      { host: '10.0.0.11', port: 2323, password: 'x', daylightHost: 'https://example.com' },
      { httpClient, logger }
    );

    const loadPromise = adapter.load('/screen/living-room', { queue: 'plex:1' });
    await jest.runAllTimersAsync();
    const result = await loadPromise;

    expect(result.ok).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.attempt).toBe(3);
    // Verify urlMismatch was logged at least once (on attempts 1 or 2)
    expect(logger.warn).toHaveBeenCalledWith(
      'fullykiosk.load.urlMismatch',
      expect.any(Object)
    );
    jest.useRealTimers();
  });

  test('returns ok:false after all retries exhausted with mismatch on every attempt', async () => {
    jest.useFakeTimers();
    const logger = makeLogger();
    const httpClient = makeHttpClient((cmd) => {
      if (cmd === 'loadURL') return { status: 200, data: { status: 'OK' } };
      if (cmd === 'deviceInfo' || cmd === 'getDeviceInfo') {
        return { status: 200, data: { currentUrl: 'https://example.com/screen/office' } };
      }
      return { status: 200, data: {} };
    });
    const adapter = new FullyKioskContentAdapter(
      { host: '10.0.0.11', port: 2323, password: 'x', daylightHost: 'https://example.com' },
      { httpClient, logger }
    );

    const loadPromise = adapter.load('/screen/living-room', { queue: 'plex:1' });
    await jest.runAllTimersAsync();
    const result = await loadPromise;

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(3);
    jest.useRealTimers();
  });

  test('returns ok:true when currentUrl is undefined but loadURL succeeded (best-effort)', async () => {
    // FKB sometimes reports currentUrl=undefined even when WebView is rendering
    // correctly. We don't want to falsely fail in that case — the verification
    // step should degrade to "best effort" and log a warning.
    jest.useFakeTimers();
    const logger = makeLogger();
    const httpClient = makeHttpClient((cmd) => {
      if (cmd === 'loadURL') return { status: 200, data: { status: 'OK' } };
      if (cmd === 'deviceInfo' || cmd === 'getDeviceInfo') {
        return { status: 200, data: { currentUrl: undefined, currentPage: 'https://example.com/screen/living-room' } };
      }
      return { status: 200, data: {} };
    });
    const adapter = new FullyKioskContentAdapter(
      { host: '10.0.0.11', port: 2323, password: 'x', daylightHost: 'https://example.com' },
      { httpClient, logger }
    );

    const loadPromise = adapter.load('/screen/living-room', { queue: 'plex:1' });
    await jest.runAllTimersAsync();
    const result = await loadPromise;

    expect(result.ok).toBe(true);
    expect(result.verified).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      'fullykiosk.load.unverified',
      expect.any(Object)
    );
    jest.useRealTimers();
  });
});
