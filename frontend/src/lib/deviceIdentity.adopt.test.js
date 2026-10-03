import { describe, it, expect, beforeEach } from 'vitest';
import { getDeviceId, adoptBrowserDeviceId, _resetDeviceIdForTests } from './deviceIdentity.js';

describe('adoptBrowserDeviceId', () => {
  beforeEach(() => {
    localStorage.clear();
    delete window.__DAYLIGHT_DEVICE_ID;
    _resetDeviceIdForTests();
  });

  it('makes an app-held browser identity the id every request carries, and keeps it across reloads', () => {
    expect(getDeviceId()).toMatch(/^browser:/);
    adoptBrowserDeviceId('11111111-2222-4333-8444-555555555555');
    expect(getDeviceId()).toBe('browser:11111111-2222-4333-8444-555555555555');
    _resetDeviceIdForTests();
    expect(getDeviceId()).toBe('browser:11111111-2222-4333-8444-555555555555');
  });

  it('never overrides a named fleet screen, and ignores an empty token', () => {
    window.__DAYLIGHT_DEVICE_ID = 'office-tv';
    adoptBrowserDeviceId('abc');
    expect(getDeviceId()).toBe('fleet:office-tv');
    delete window.__DAYLIGHT_DEVICE_ID;
    _resetDeviceIdForTests();
    const before = getDeviceId();
    adoptBrowserDeviceId('');
    expect(getDeviceId()).toBe(before);
  });
});
