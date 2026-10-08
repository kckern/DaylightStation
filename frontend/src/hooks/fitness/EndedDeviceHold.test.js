import { describe, expect, it } from 'vitest';
import { EndedDeviceHold } from './EndedDeviceHold.js';

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

describe('EndedDeviceHold', () => {
  it('suppresses held devices while allowing a different device', () => {
    let now = new Date(2026, 9, 7, 16, 0).getTime();
    const hold = new EndedDeviceHold({ storage: new MemoryStorage(), now: () => now });

    hold.hold(['hr-test-sibling']);

    expect(hold.filter('hr-test-sibling')).toBe(false);
    expect(hold.filter('hr-test-learner')).toBe(true);
  });

  it('clears a held device only after the configured absence timeout', () => {
    let now = new Date(2026, 9, 7, 16, 0).getTime();
    const hold = new EndedDeviceHold({ storage: new MemoryStorage(), now: () => now });
    hold.hold(['hr-test-sibling']);

    now += 20 * 60_000;
    expect(hold.filter('hr-test-sibling')).toBe(false); // packets are still arriving
    now += 29 * 60_000;
    hold.observeAbsence([], 30 * 60_000);
    expect(hold.filter('hr-test-sibling')).toBe(false);

    now += 31 * 60_000;
    hold.observeAbsence([], 30 * 60_000);
    expect(hold.filter('hr-test-sibling')).toBe(true);
  });

  it('restores held devices after a reload', () => {
    const storage = new MemoryStorage();
    const now = new Date(2026, 9, 7, 16, 0).getTime();
    new EndedDeviceHold({ storage, now: () => now }).hold(['hr-test-sibling']);

    const restored = new EndedDeviceHold({ storage, now: () => now + 5_000 });

    expect(restored.filter('hr-test-sibling')).toBe(false);
  });

  it('expires all holds at the next local day boundary', () => {
    const storage = new MemoryStorage();
    let now = new Date(2026, 9, 7, 23, 59).getTime();
    const hold = new EndedDeviceHold({ storage, now: () => now });
    hold.hold(['hr-test-sibling']);

    now = new Date(2026, 9, 8, 0, 0, 1).getTime();

    expect(hold.filter('hr-test-sibling')).toBe(true);
  });
});
