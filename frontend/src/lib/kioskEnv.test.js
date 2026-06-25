import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isKioskEnv, __resetKioskEnvCache } from './kioskEnv.js';

// jsdom defaults to http://localhost/ — override hostname/search per case.
function setLocation({ hostname = 'localhost', search = '' }) {
  vi.stubGlobal('location', { hostname, search });
  // window.location is what the util reads
  Object.defineProperty(window, 'location', { value: { hostname, search }, writable: true, configurable: true });
}

describe('isKioskEnv', () => {
  beforeEach(() => { __resetKioskEnvCache(); });
  afterEach(() => { __resetKioskEnvCache(); vi.unstubAllGlobals(); });

  it('is false on localhost (dev)', () => {
    setLocation({ hostname: 'localhost' });
    expect(isKioskEnv()).toBe(false);
  });

  it('is true for a non-localhost Firefox host (the garage kiosk)', () => {
    setLocation({ hostname: 'daylightlocal.kckern.net', search: '' });
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (X11; Linux) Gecko/20100101 Firefox/126.0', configurable: true,
    });
    expect(isKioskEnv()).toBe(true);
  });

  it('?kiosk=1 forces kiosk on even from localhost', () => {
    setLocation({ hostname: 'localhost', search: '?kiosk=1' });
    expect(isKioskEnv()).toBe(true);
  });

  it('?nokiosk forces kiosk off', () => {
    setLocation({ hostname: 'daylightlocal.kckern.net', search: '?nokiosk' });
    expect(isKioskEnv()).toBe(false);
  });
});
