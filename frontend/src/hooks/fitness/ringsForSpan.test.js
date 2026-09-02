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

  it('tolerates a few ticks of overhang at the session tail', () => {
    // 60 ticks recorded; an item ending a tick or two past the last is ordinary
    // rounding, not missing data.
    expect(ringsForSpan(cumulative, min(4), min(5) + 10_000, S, 5)).toBe(590 - 470);
  });

  it('refuses an item running far past the recorded ticks', () => {
    // Session 20260901154746: a 444-tick workout against a 235-tick series that
    // covered a different stretch of the session. Clamping to the last value
    // credited the workout with every ring the session earned.
    expect(ringsForSpan(cumulative, min(4), min(99), S, 5)).toBeNull();
  });
});

describe('ringsForSpan — a null-padded series', () => {
  // A repaired window null-pads the series out to the full axis. Array length
  // then overstates coverage: the data may span 20 minutes inside a 94-minute
  // array, and an item in the padded region must score null, not the remainder.
  const padded = [...Array.from({ length: 20 }, (_, i) => i * 10), ...new Array(40).fill(null)];

  it('scores an item inside the recorded stretch', () => {
    // Covers ticks 0..9; cumulative[9] is 90 against a baseline of 0.
    expect(ringsForSpan(padded, S, S + 50_000, S, 5)).toBe(90);
  });

  it('refuses an item out in the padding', () => {
    expect(ringsForSpan(padded, S + 200_000, S + 250_000, S, 5)).toBeNull();
  });

  it('refuses a series that is nothing but padding', () => {
    expect(ringsForSpan(new Array(40).fill(null), S, S + 50_000, S, 5)).toBeNull();
  });
});
