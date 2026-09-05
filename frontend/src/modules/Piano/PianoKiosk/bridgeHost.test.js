/**
 * Two forgotten Chrome tabs on a Mac retried ws://localhost:8770 for ~49 hours
 * and produced ~1,000 ERROR rows an hour — 100% of the log store's error volume
 * at the time. This helper is what stops a host that CANNOT have the APK from
 * treating its absence as a fault, while still letting the fake-bridge harness
 * connect normally.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bridgeHostPlausible, __resetBridgeHostCache } from './bridgeHost.js';

const TABLET_UA = 'Mozilla/5.0 (Linux; Android 9; Portal Build/PKQ1) AppleWebKit/537.36 Chrome/131.0.0.0';
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36';

const setEnv = ({ search = '', hostname = 'daylightlocal.kckern.net', ua = MAC_UA }) => {
  vi.stubGlobal('window', { location: { search, hostname } });
  vi.stubGlobal('navigator', { userAgent: ua });
};

describe('bridgeHostPlausible', () => {
  beforeEach(() => __resetBridgeHostCache());
  afterEach(() => { vi.unstubAllGlobals(); __resetBridgeHostCache(); });

  it('is true on the Android tablet, where the APK actually runs', () => {
    setEnv({ ua: TABLET_UA });
    expect(bridgeHostPlausible()).toBe(true);
  });

  it('is false on a LAN laptop — the flooding case', () => {
    setEnv({ ua: MAC_UA });
    expect(bridgeHostPlausible()).toBe(false);
  });

  it('is true on localhost so the fake-bridge harness keeps working', () => {
    // The headless-MIDI harness serves the same WS on the dev machine; treating
    // it as implausible would quieten a bridge that genuinely is there.
    setEnv({ hostname: 'localhost', ua: MAC_UA });
    expect(bridgeHostPlausible()).toBe(true);
  });

  it.each([
    ['?bridge', true],
    ['?bridge=1', true],
    ['?bridge=0', false],
    ['?nobridge', false],
  ])('honours the %s override', (search, expected) => {
    // Overrides win over the platform: ?bridge forces the loud path on a laptop,
    // ?nobridge silences a tablet deliberately.
    setEnv({ search, ua: search.includes('nobridge') || search === '?bridge=0' ? TABLET_UA : MAC_UA });
    expect(bridgeHostPlausible()).toBe(expected);
  });

  it('memoizes — the host cannot change mid-session', () => {
    setEnv({ ua: TABLET_UA });
    expect(bridgeHostPlausible()).toBe(true);
    setEnv({ ua: MAC_UA });
    expect(bridgeHostPlausible()).toBe(true);
  });

  it('assumes a bridge is possible when the environment is unreadable', () => {
    // Failing open costs log volume; failing closed would hide a dead APK on
    // the real tablet, which is the failure this logging exists to catch.
    vi.stubGlobal('window', undefined);
    expect(bridgeHostPlausible()).toBe(true);
  });
});
