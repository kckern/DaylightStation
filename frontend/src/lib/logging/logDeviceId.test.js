import { describe, it, expect, vi } from 'vitest';
import { readLogDeviceId, LOG_DEVICE_STORAGE_KEY } from './logDeviceId.js';

const memoryStore = (init = {}) => {
  const data = { ...init };
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, data };
};

describe('readLogDeviceId', () => {
  it('takes ?device= from the URL and persists it', () => {
    const store = memoryStore();
    expect(readLogDeviceId({ search: '?device=garage-tv&x=1' }, store)).toBe('garage-tv');
    expect(store.data[LOG_DEVICE_STORAGE_KEY]).toBe('garage-tv');
  });

  it('survives the router dropping the query (persisted value)', () => {
    const store = memoryStore({ [LOG_DEVICE_STORAGE_KEY]: 'garage-tv' });
    expect(readLogDeviceId({ search: '' }, store)).toBe('garage-tv');
  });

  it('falls back to the identities the fitness and piano apps already persist', () => {
    expect(readLogDeviceId({ search: '' }, memoryStore({ 'fitness.fleetDeviceId': 'garage-tv' }))).toBe('garage-tv');
    expect(readLogDeviceId({ search: '' }, memoryStore({ 'piano.kioskDeviceId': 'piano-tablet' }))).toBe('piano-tablet');
  });

  it('keeps the URL id per tab; the kiosk ids come from the kiosk store', () => {
    const tab = memoryStore();
    const kiosk = memoryStore({ 'fitness.fleetDeviceId': 'garage-tv' });
    expect(readLogDeviceId({ search: '?device=office-tv' }, tab, kiosk)).toBe('office-tv');
    expect(readLogDeviceId({ search: '' }, tab, kiosk)).toBe('office-tv');
    expect(kiosk.data[LOG_DEVICE_STORAGE_KEY]).toBeUndefined();
    expect(readLogDeviceId({ search: '' }, memoryStore(), kiosk)).toBe('garage-tv');
    expect(readLogDeviceId({ search: '' }, memoryStore(), memoryStore())).toBeNull();
  });

  it('is null when nothing identifies the screen, and never throws', () => {
    expect(readLogDeviceId({ search: '' }, memoryStore())).toBeNull();
    expect(readLogDeviceId(undefined, null)).toBeNull();
    const throwing = { getItem: vi.fn(() => { throw new Error('denied'); }), setItem: vi.fn(() => { throw new Error('denied'); }) };
    expect(readLogDeviceId({ search: '?device=a' }, throwing)).toBe('a');
    expect(readLogDeviceId({ search: '' }, throwing)).toBeNull();
  });
});
