import { describe, it, expect } from 'vitest';
import { decideStallVerdict } from './stallVerdict.js';

describe('decideStallVerdict', () => {
  const base = {
    now: 10_000,
    lastProgressTs: 8_700,    // 1300ms since last timeupdate (just past softMs)
    softMs: 1200,
    currentTime: 100.0,
    lastObservedCurrentTime: 100.0,
    progressEpsilon: 0.05
  };

  it('returns "stalled" when both the timer gap exceeds softMs AND currentTime has not advanced', () => {
    const v = decideStallVerdict(base);
    expect(v.verdict).toBe('stalled');
    expect(v.stallDurationMs).toBe(1300);
  });

  it('returns "progressing" when currentTime has advanced past epsilon despite a long timeupdate gap', () => {
    // Audit 2026-05-23 §1: the canonical false-positive shape.
    // timeupdate was throttled; currentTime advanced anyway.
    const v = decideStallVerdict({ ...base, currentTime: 101.2 });
    expect(v.verdict).toBe('progressing');
    expect(v.stallDurationMs).toBeNull();
  });

  it('treats sub-epsilon currentTime drift as not progressing', () => {
    const v = decideStallVerdict({ ...base, currentTime: 100.01 }); // 10ms drift
    expect(v.verdict).toBe('stalled');
  });

  it('respects exactly-at-epsilon (boundary)', () => {
    // currentTime advanced by exactly 0.05 — counts as progressing
    const v = decideStallVerdict({ ...base, currentTime: 100.05 });
    expect(v.verdict).toBe('progressing');
  });

  it('returns "within-window" when the timer gap is below softMs (no decision yet)', () => {
    const v = decideStallVerdict({ ...base, lastProgressTs: 9_500 }); // 500ms gap
    expect(v.verdict).toBe('within-window');
    expect(v.stallDurationMs).toBeNull();
  });

  it('returns "within-window" when lastProgressTs is 0 (no progress yet ever)', () => {
    const v = decideStallVerdict({ ...base, lastProgressTs: 0 });
    expect(v.verdict).toBe('within-window');
  });

  it('handles invalid currentTime / lastObservedCurrentTime by falling back to time-gap only', () => {
    // No currentTime evidence available — must decide on timer alone (legacy behavior).
    const v = decideStallVerdict({ ...base, currentTime: NaN });
    expect(v.verdict).toBe('stalled');
    const v2 = decideStallVerdict({ ...base, lastObservedCurrentTime: NaN });
    expect(v2.verdict).toBe('stalled');
  });

  it('handles backwards currentTime drift (negative delta) as not-progressing', () => {
    // Browser may report a slightly-lower currentTime briefly during a seek.
    const v = decideStallVerdict({ ...base, currentTime: 99.5 });
    expect(v.verdict).toBe('stalled');
  });
});
