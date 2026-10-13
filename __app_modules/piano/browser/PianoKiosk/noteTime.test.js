import { describe, it, expect } from 'vitest';
import { resolveNoteTime, webMidiEventEpochMs, MAX_SKEW_MS } from './noteTime.js';

describe('resolveNoteTime', () => {
  const receipt = 1_800_000_000_000;

  it('keeps a fresh event time and reports the lag', () => {
    expect(resolveNoteTime(receipt - 120, receipt)).toEqual({ time: receipt - 120, timed: true, lagMs: 120 });
  });

  it('accepts the edge of the skew window in both directions', () => {
    expect(resolveNoteTime(receipt - MAX_SKEW_MS, receipt).timed).toBe(true);
    expect(resolveNoteTime(receipt + MAX_SKEW_MS, receipt).timed).toBe(true);
  });

  it('falls back to receipt for a stale or future stamp', () => {
    expect(resolveNoteTime(receipt - MAX_SKEW_MS - 1, receipt)).toEqual({ time: receipt, timed: false, lagMs: null });
    expect(resolveNoteTime(receipt + 5000, receipt).time).toBe(receipt);
  });

  it('falls back to receipt when the time is missing or not a finite number', () => {
    for (const t of [undefined, null, NaN, Infinity, '1800000000000']) {
      expect(resolveNoteTime(t, receipt)).toEqual({ time: receipt, timed: false, lagMs: null });
    }
  });
});

describe('webMidiEventEpochMs', () => {
  it('adds the event timeStamp to performance.timeOrigin', () => {
    expect(webMidiEventEpochMs({ timeStamp: 250.5 }, { timeOrigin: 1_000_000 })).toBe(1_000_250.5);
  });

  it('is undefined when the timestamp is absent or zero, or there is no timeOrigin', () => {
    expect(webMidiEventEpochMs({}, { timeOrigin: 1 })).toBeUndefined();
    expect(webMidiEventEpochMs({ timeStamp: 0 }, { timeOrigin: 1 })).toBeUndefined();
    expect(webMidiEventEpochMs({ timeStamp: 5 }, {})).toBeUndefined();
    expect(webMidiEventEpochMs({ timeStamp: 5 }, null)).toBeUndefined();
  });
});
