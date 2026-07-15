import { describe, it, expect, beforeEach } from 'vitest';
import { readKioskDeviceId, KIOSK_DEVICE_STORAGE_KEY } from './kioskDeviceIdentity.js';

function makeStore(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    _map: map,
  };
}

describe('readKioskDeviceId', () => {
  it('captures ?device= from the URL and persists it to localStorage', () => {
    const store = makeStore();
    const id = readKioskDeviceId({ search: '?device=yellow-room-tablet' }, store);
    expect(id).toBe('yellow-room-tablet');
    expect(store.getItem(KIOSK_DEVICE_STORAGE_KEY)).toBe('yellow-room-tablet');
  });

  it('falls back to the persisted value when the URL has no device param (SPA rewrote it away)', () => {
    const store = makeStore({ [KIOSK_DEVICE_STORAGE_KEY]: 'yellow-room-tablet' });
    const id = readKioskDeviceId({ search: '?foo=bar' }, store);
    expect(id).toBe('yellow-room-tablet');
  });

  it('returns null for a client that never carried the param and has nothing stored (a laptop opening /piano)', () => {
    const store = makeStore();
    expect(readKioskDeviceId({ search: '' }, store)).toBe(null);
  });

  it('URL param wins over and overwrites a stale stored value', () => {
    const store = makeStore({ [KIOSK_DEVICE_STORAGE_KEY]: 'old-device' });
    const id = readKioskDeviceId({ search: '?device=new-device' }, store);
    expect(id).toBe('new-device');
    expect(store.getItem(KIOSK_DEVICE_STORAGE_KEY)).toBe('new-device');
  });

  it('never throws when storage is unavailable', () => {
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(() => readKioskDeviceId({ search: '?device=x' }, throwing)).not.toThrow();
    expect(readKioskDeviceId({ search: '?device=x' }, throwing)).toBe(null);
  });
});
