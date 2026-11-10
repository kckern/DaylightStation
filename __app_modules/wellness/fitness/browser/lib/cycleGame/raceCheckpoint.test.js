import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeCheckpoint, readFreshCheckpoint, clearCheckpoint, checkpointRaceState, checkpointOutcome } from "./raceCheckpoint.js";

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
const engineState = { elapsedS: 42, riders: { user_1: { userId: 'user_1', cumulativeDistanceM: 500 } } };

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

describe('raceCheckpoint — race state carried for recovery', () => {
  let store;
  beforeEach(() => { store = makeStore(); });
  const raceState = { parked: ['user_1'], noSensor: ['user_2'], endedEarly: false, finished: false };

  it('round-trips the race state (parked, noSensor, endedEarly, finished)', () => {
    writeCheckpoint(store, { raceMeta, engineState, raceState, savedAt: 1000 });
    expect(readFreshCheckpoint(store, 1000).raceState).toEqual(raceState);
  });

  it('a checkpoint written without race state reads back with none', () => {
    writeCheckpoint(store, { raceMeta, engineState, savedAt: 1000 });
    expect(readFreshCheckpoint(store, 1000).raceState).toBeUndefined();
  });

  it('normalizes a malformed race state instead of rejecting the checkpoint', () => {
    store.setItem('cycleGame.checkpoint', JSON.stringify({
      raceMeta, engineState, savedAt: 1000, raceState: { parked: 'user_1', noSensor: [7, 'user_2'], endedEarly: 'yes', finished: 1 }
    }));
    expect(readFreshCheckpoint(store, 1000).raceState)
      .toEqual({ parked: [], noSensor: ['user_2'], endedEarly: false, finished: false });
  });

  it('checkpointRaceState reads parked, noSensor, endedEarly and finished off the controller state', () => {
    expect(checkpointRaceState({ phase: 'racing', parked: ['user_1'], noSensor: [], endedEarly: false, overtime: ['user_2'] }))
      .toEqual({ parked: ['user_1'], noSensor: [], endedEarly: false, finished: false });
    expect(checkpointRaceState({ phase: 'finished', parked: [], noSensor: ['user_2'], endedEarly: true }))
      .toEqual({ parked: [], noSensor: ['user_2'], endedEarly: true, finished: true });
    expect(checkpointRaceState({ phase: 'results' }).finished).toBe(true);
    expect(checkpointRaceState(undefined)).toEqual({ parked: [], noSensor: [], endedEarly: false, finished: false });
  });

  describe('checkpointOutcome (what a recovered record is saved as)', () => {
    it('a race still running when the page died is ended early; its stopped riders are kept', () => {
      expect(checkpointOutcome({ raceState }))
        .toEqual({ endedEarly: true, stopped: ['user_1', 'user_2'] });
    });
    it('a race that had finished on its own is complete', () => {
      expect(checkpointOutcome({ raceState: { ...raceState, finished: true } }))
        .toEqual({ endedEarly: false, stopped: ['user_1', 'user_2'] });
    });
    it('a race ended from the menu stays ended early', () => {
      expect(checkpointOutcome({ raceState: { parked: [], noSensor: [], endedEarly: true, finished: true } }))
        .toEqual({ endedEarly: true, stopped: [] });
    });
    it('a checkpoint with no race state (written by an older build) is ended early', () => {
      expect(checkpointOutcome({ raceMeta, engineState })).toEqual({ endedEarly: true, stopped: [] });
      expect(checkpointOutcome(null)).toEqual({ endedEarly: true, stopped: [] });
    });
  });
});
