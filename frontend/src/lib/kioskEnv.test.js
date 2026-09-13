import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isKioskEnv, isLocalDevHost, __resetKioskEnvCache } from './kioskEnv.js';

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

// The admin gate's only exemption. It is NOT "not the kiosk": a tablet on the
// household host is not the kiosk and must still be asked for approval.
describe('isLocalDevHost', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('is true only on a developer\'s own machine', () => {
    setLocation({ hostname: 'localhost' });
    expect(isLocalDevHost()).toBe(true);
    setLocation({ hostname: '127.0.0.1' });
    expect(isLocalDevHost()).toBe(true);
  });

  it('is false for every browser on the household host, kiosk or not', () => {
    setLocation({ hostname: 'daylightlocal.kckern.net' });
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15', configurable: true,
    });
    expect(isLocalDevHost()).toBe(false);
  });

  it('cannot be switched on by a URL parameter', () => {
    setLocation({ hostname: 'daylightlocal.kckern.net', search: '?nokiosk' });
    expect(isLocalDevHost()).toBe(false);
  });
});
