import { vi } from 'vitest';
import { FullyKioskContentAdapter } from '#adapters/devices/FullyKioskContentAdapter.mjs';

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeHttpClient(handler) {
  return {
    get: vi.fn(async (url) => {
      const match = url.match(/\bcmd=([^&]+)/);
      return handler(match ? match[1] : null, url);
    })
  };
}

function makeAdapter(handler, logger = makeLogger()) {
  return new FullyKioskContentAdapter(
    { host: '10.0.0.245', port: 2323, password: 'x', daylightHost: 'https://example.com' },
    { httpClient: makeHttpClient(handler), logger }
  );
}

describe('FullyKioskContentAdapter response-shape classification', () => {
  test('auth-error envelope aborts prepare immediately instead of walking the retry loop', async () => {
    const logger = makeLogger();
    const adapter = makeAdapter(() => (
      { status: 200, data: { status: 'Error', statustext: 'Please login' } }
    ), logger);
    const result = await adapter.prepareForContent({ skipCameraCheck: true });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/login/i);
    // Must not have hammered the device: the old code sent 15 toForeground +
    // 15 getDeviceInfo before failing.
    expect(logger.warn).toHaveBeenCalledWith('fullykiosk.sendCommand.rejected', expect.objectContaining({ authError: true }));
  });

  test('non-auth Error envelope fails the command that received it', async () => {
    const adapter = makeAdapter((cmd) => {
      if (cmd === 'screenOn') return { status: 200, data: { status: 'Error', statustext: 'Something broke' } };
      return { status: 200, data: { status: 'OK' } };
    });
    const result = await adapter.prepareForContent({ skipCameraCheck: true });
    expect(result.ok).toBe(false);
    expect(result.step).toBe('screenOn');
    expect(result.error).toMatch(/Something broke/);
  });

  test('HTML dashboard body is reported as an unusable payload, not as success', async () => {
    const logger = makeLogger();
    const adapter = makeAdapter((cmd) => {
      if (cmd === 'screenOn') return { status: 200, data: '<!DOCTYPE html><html><body>Fully Kiosk admin</body></html>' };
      return { status: 200, data: { status: 'OK' } };
    }, logger);
    const result = await adapter.prepareForContent({ skipCameraCheck: true });
    expect(result.ok).toBe(false);
    expect(result.step).toBe('screenOn');
    expect(logger.warn).toHaveBeenCalledWith(
      'fullykiosk.sendCommand.nonJsonResponse',
      expect.objectContaining({ cmd: 'screenOn', snippet: expect.stringContaining('DOCTYPE') })
    );
  });

  test('normal OK acks and device-info payloads still succeed', async () => {
    const adapter = makeAdapter((cmd) => {
      if (cmd === 'getDeviceInfo' || cmd === 'deviceInfo') {
        return { status: 200, data: { foreground: 'de.ozerov.fully', screenOn: true } };
      }
      return { status: 200, data: { status: 'OK' } };
    });
    const result = await adapter.prepareForContent({ skipCameraCheck: true });
    expect(result.ok).toBe(true);
  });
});
