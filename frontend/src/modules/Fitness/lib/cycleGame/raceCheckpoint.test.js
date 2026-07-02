import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeCheckpoint, readFreshCheckpoint, clearCheckpoint } from './raceCheckpoint.js';

// Minimal sessionStorage-shaped in-memory stub — injected so the lib stays
// storage-agnostic and these tests don't depend on jsdom's real implementation.
function makeStore(initial = {}) {
  const data = { ...initial };
  return {
    getItem: vi.fn((key) => (key in data ? data[key] : null)),
    setItem: vi.fn((key, value) => { data[key] = value; }),
    removeItem: vi.fn((key) => { delete data[key]; }),
    _data: data
  };
}

const raceMeta = { raceId: '20260701120000', winCondition: 'distance', goalM: 3000 };
const engineState = { elapsedS: 42, riders: { kckern: { userId: 'kckern', cumulativeDistanceM: 500 } } };

describe('raceCheckpoint', () => {
  let store;
  beforeEach(() => { store = makeStore(); });

  it('writes and reads back a fresh checkpoint', () => {
    writeCheckpoint(store, { raceMeta, engineState, savedAt: 1000 });
    const result = readFreshCheckpoint(store, 1000 + 60_000); // 1 min later, well within maxAge
    expect(result).toEqual({ raceMeta, engineState, savedAt: 1000 });
  });

  it('returns null for a stale checkpoint (older than maxAgeMs)', () => {
    writeCheckpoint(store, { raceMeta, engineState, savedAt: 0 });
    const maxAgeMs = 30 * 60 * 1000;
    const result = readFreshCheckpoint(store, maxAgeMs + 1, maxAgeMs);
    expect(result).toBeNull();
  });

  it('honors a custom maxAgeMs at the boundary', () => {
    writeCheckpoint(store, { raceMeta, engineState, savedAt: 0 });
    expect(readFreshCheckpoint(store, 5000, 5000)).toEqual({ raceMeta, engineState, savedAt: 0 });
    expect(readFreshCheckpoint(store, 5001, 5000)).toBeNull();
  });

  it('returns null for corrupt JSON', () => {
    store.setItem('cycleGame.checkpoint', '{not json');
    expect(readFreshCheckpoint(store, 0)).toBeNull();
  });

  it('returns null when no checkpoint is present', () => {
    expect(readFreshCheckpoint(store, 0)).toBeNull();
  });

  it('returns null when raceMeta.raceId is missing', () => {
    writeCheckpoint(store, { raceMeta: { winCondition: 'distance' }, engineState, savedAt: 0 });
    expect(readFreshCheckpoint(store, 0)).toBeNull();
  });

  it('returns null when engineState.riders is missing', () => {
    writeCheckpoint(store, { raceMeta, engineState: { elapsedS: 42 }, savedAt: 0 });
    expect(readFreshCheckpoint(store, 0)).toBeNull();
  });

  it('swallows a quota-exceeded error on write and never throws', () => {
    store.setItem = vi.fn(() => { throw new Error('QuotaExceededError'); });
    expect(() => writeCheckpoint(store, { raceMeta, engineState, savedAt: 0 })).not.toThrow();
    // Nothing was persisted — a subsequent read finds nothing.
    store.getItem = vi.fn(() => null);
    expect(readFreshCheckpoint(store, 0)).toBeNull();
  });

  it('clearCheckpoint removes the entry and never throws on a missing store', () => {
    writeCheckpoint(store, { raceMeta, engineState, savedAt: 0 });
    clearCheckpoint(store);
    expect(store.removeItem).toHaveBeenCalledWith('cycleGame.checkpoint');
    expect(readFreshCheckpoint(store, 0)).toBeNull();
    expect(() => clearCheckpoint(null)).not.toThrow();
    expect(() => writeCheckpoint(null, { raceMeta, engineState, savedAt: 0 })).not.toThrow();
    expect(readFreshCheckpoint(null, 0)).toBeNull();
  });

  it('swallows a removeItem error and never throws', () => {
    store.removeItem = vi.fn(() => { throw new Error('boom'); });
    expect(() => clearCheckpoint(store)).not.toThrow();
  });
});
