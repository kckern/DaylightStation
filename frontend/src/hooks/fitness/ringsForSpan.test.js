import { describe, it, expect } from 'vitest';
import { ringsForSpan } from './buildSessionSummary.js';

const S = 1_700_000_000_000;
const min = (n) => S + n * 60_000;
// Cumulative rings, one entry per 5s tick: 12 ticks = 1 minute.
const cumulative = Array.from({ length: 60 }, (_, i) => i * 10); // +10 rings/tick

describe('ringsForSpan', () => {
  it('is the difference across the item, not the running total', () => {
    // Covers ticks 12..23: cumulative[23] - cumulative[11] = 230 - 110.
    expect(ringsForSpan(cumulative, min(1), min(2), S, 5)).toBe(120);
  });

  it('treats an item starting at tick 0 as starting from nothing earned', () => {
    // Covers ticks 0..11; cumulative[11] is 110 and the baseline is 0.
    expect(ringsForSpan(cumulative, S, min(1), S, 5)).toBe(110);
  });

  it('returns null when the series does not reach the item', () => {
    // The truncated-series case: a resume dropped the earlier ticks, so an item
    // before the series began is UNKNOWN, not zero — scoring it zero would drop
    // exactly the workout we are trying to find.
    expect(ringsForSpan(cumulative, min(-30), min(-20), S, 5)).toBeNull();
  });

  it('returns null with no series at all', () => {
    expect(ringsForSpan(null, S, min(1), S, 5)).toBeNull();
    expect(ringsForSpan([], S, min(1), S, 5)).toBeNull();
  });

  it('returns null when a timestamp is missing', () => {
    expect(ringsForSpan(cumulative, null, min(1), S, 5)).toBeNull();
    expect(ringsForSpan(cumulative, S, min(1), null, 5)).toBeNull();
  });

  it('reads through null gaps to the last real value', () => {
    const gappy = [0, 10, null, null, 40, 50];
    expect(ringsForSpan(gappy, S, S + 30_000, S, 5)).toBe(50);
  });

  it('never reports a negative contribution', () => {
    const wobbly = [100, 90, 80];
    expect(ringsForSpan(wobbly, S + 5_000, S + 10_000, S, 5)).toBe(0);
  });

  it('clamps an item running past the end of the series', () => {
    expect(ringsForSpan(cumulative, min(4), min(99), S, 5)).toBe(590 - 470);
  });
});
