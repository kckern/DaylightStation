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

  it('reports the id it replaced so spots can follow, and nothing when unchanged', () => {
    const before = getDeviceId();
    expect(adoptBrowserDeviceId('client-1')).toBe(before);
    expect(adoptBrowserDeviceId('client-1')).toBe(null);
  });

  it('never overrides a named fleet screen, and ignores an empty token', () => {
    window.__DAYLIGHT_DEVICE_ID = 'office-tv';
    expect(adoptBrowserDeviceId('abc')).toBe(null);
    expect(getDeviceId()).toBe('fleet:office-tv');
    expect(localStorage.getItem('ds_device_id')).toBe(null);
    delete window.__DAYLIGHT_DEVICE_ID;
    _resetDeviceIdForTests();
    const before = getDeviceId();
    adoptBrowserDeviceId('');
    expect(getDeviceId()).toBe(before);
  });
});
