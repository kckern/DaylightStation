// Tier 2, Task 2.2 — the frontend half.
//
// Backend logs could not name a client: all frontend traffic arrives from the
// docker network, so every request shares one source IP. This module mints the
// id `lib/api.mjs` sends as X-Daylight-Device.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getDeviceId, _resetDeviceIdForTests } from './deviceIdentity.js';

describe('getDeviceId', () => {
  beforeEach(() => {
    _resetDeviceIdForTests();
    window.localStorage.clear();
    delete window.__DAYLIGHT_DEVICE_ID;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete window.__DAYLIGHT_DEVICE_ID;
  });

  it('is stable across calls', () => {
    expect(getDeviceId()).toBe(getDeviceId());
  });

  it('survives a page reload, which is what makes it a DEVICE id', () => {
    const first = getDeviceId();

    // A reload is a fresh module instance over the same localStorage.
    _resetDeviceIdForTests();

    expect(getDeviceId()).toBe(first);
  });

  it('gives two browser profiles two ids', () => {
    const first = getDeviceId();

    _resetDeviceIdForTests();
    window.localStorage.clear();

    expect(getDeviceId()).not.toBe(first);
  });

  it('prefers the fleet name when one is published', () => {
    window.__DAYLIGHT_DEVICE_ID = 'piano-tablet';

    // Joinable to devices.yml, which a random token is not.
    expect(getDeviceId()).toBe('fleet:piano-tablet');
  });

  it('says which kind of id it is, in the value', () => {
    // 'browser:' claims persistence. Only a stored token may claim it.
    expect(getDeviceId()).toMatch(/^browser:/);
  });

  it('marks the id ephemeral when it could not be persisted', () => {
    // Private mode, a disabled store, a quota refusal. A value that silently
    // fails to persist while still reading as `browser:` would make one kiosk
    // look like a stream of new devices.
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(getDeviceId()).toMatch(/^ephemeral:/);
  });

  it('is header-safe — it goes out as an HTTP header value', () => {
    expect(getDeviceId()).toMatch(/^[A-Za-z0-9:_-]+$/);
  });
});
