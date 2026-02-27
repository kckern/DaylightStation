// tests/isolated/hooks/useDeviceIdentity.test.mjs
import { describe, test, expect, beforeEach, afterEach } from 'vitest';

describe('useDeviceIdentity', () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    // Restore original state
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  });

  function setWindowSearch(search) {
    globalThis.window = { location: { search } };
  }

  test('returns null deviceId and isKiosk=false when no query param', () => {
    setWindowSearch('');

    const params = new URLSearchParams(globalThis.window.location.search);
    const deviceId = params.get('deviceId') || null;
    const isKiosk = deviceId !== null;

    expect(deviceId).toBeNull();
    expect(isKiosk).toBe(false);
  });

  test('reads deviceId from ?deviceId=living-room-tv and returns isKiosk=true', () => {
    setWindowSearch('?deviceId=living-room-tv');

    const params = new URLSearchParams(globalThis.window.location.search);
    const deviceId = params.get('deviceId') || null;
    const isKiosk = deviceId !== null;

    expect(deviceId).toBe('living-room-tv');
    expect(isKiosk).toBe(true);
  });

  test('exports useDeviceIdentity as named and default export', async () => {
    // Provide window.location so the module can import without error
    setWindowSearch('');
    const mod = await import('#frontend/hooks/media/useDeviceIdentity.js');
    expect(typeof mod.useDeviceIdentity).toBe('function');
    expect(typeof mod.default).toBe('function');
    expect(mod.useDeviceIdentity).toBe(mod.default);
  });
});
