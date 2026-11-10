import { describe, it, expect } from 'vitest';
import {
  ZONE_TRUST_STORAGE_KEY, ZONE_TRUST_RELOAD_WINDOW_MS,
  buildEntry, filterFresh, newestEvidence, loadEntry, saveEntry
} from './zoneTrustLocalStore.js';

const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
};
const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); } };
const ev = (at, extra = {}) => ({ deviceId: 'strap-a1', zoneId: 'warm', heartRate: 150, at, ...extra });

describe('zoneTrustLocalStore', () => {
  it('round-trips an entry and stringifies strap ids', () => {
    const storage = memory();
    const entry = buildEntry([{ userId: 'rider-a', evidence: ev(1000) }], 2000);
    expect(saveEntry(storage, entry)).toBe(true);
    expect(loadEntry(storage)).toEqual({ ok: true, entry: { savedAt: 2000, riders: [{ userId: 'rider-a', evidence: { deviceId: 'strap-a1', zoneId: 'warm', heartRate: 150, at: 1000 } }] } });
    expect(storage.map.has(ZONE_TRUST_STORAGE_KEY)).toBe(true);
  });

  it('never stores simulated or malformed evidence', () => {
    const entry = buildEntry([
      { userId: 'sim', evidence: ev(1000, { simulated: true }) },
      { userId: 'nohr', evidence: { at: 1000 } },
      { userId: 'none', evidence: null },
      { userId: 'real', evidence: ev(1000) }
    ], 2000);
    expect(entry.riders.map((r) => r.userId)).toEqual(['real']);
  });

  it('splits fresh from stale at the 30 min reload window', () => {
    const now = 10 * 60 * 60 * 1000;
    const entry = { riders: [
      { userId: 'fresh', evidence: ev(now - ZONE_TRUST_RELOAD_WINDOW_MS) },
      { userId: 'stale', evidence: ev(now - ZONE_TRUST_RELOAD_WINDOW_MS - 1) },
      { userId: 'future', evidence: ev(now + 5000) }
    ] };
    const { fresh, stale } = filterFresh(entry, now);
    expect(fresh.map((r) => r.userId)).toEqual(['fresh']);
    expect(stale.map((r) => r.userId)).toEqual(['stale', 'future']);
  });

  it('keeps the newest of two readings', () => {
    expect(newestEvidence(ev(1), ev(2)).at).toBe(2);
    expect(newestEvidence(ev(3), ev(2)).at).toBe(3);
    expect(newestEvidence(null, ev(2)).at).toBe(2);
    expect(newestEvidence(ev(1), null).at).toBe(1);
  });

  it('missing or throwing storage is a no-op, never an error', () => {
    expect(loadEntry(null)).toEqual({ ok: false });
    expect(saveEntry(null, {})).toBe(false);
    expect(loadEntry(throwing)).toEqual({ ok: false });
    expect(saveEntry(throwing, { riders: [] })).toBe(false);
    expect(loadEntry({ getItem: () => '{not json' })).toEqual({ ok: false });
    expect(loadEntry(memory())).toEqual({ ok: true, entry: null });
  });
});
