import { describe, it, expect } from 'vitest';
import { isNearEnd, NEAR_END_THRESHOLD_SECONDS } from './nearEnd.js';

describe('isNearEnd', () => {
  it('is true at exactly duration', () => {
    expect(isNearEnd(677.418, 677.418)).toBe(true);
  });

  it('is true inside the default threshold', () => {
    expect(isNearEnd(677.0, 677.418)).toBe(true);
  });

  it('is false outside the threshold', () => {
    // The 2026-07-10 stall began at 659.5s of a 677.4s asset — mid-stream,
    // not end-of-content. It must NOT be treated as near-end.
    expect(isNearEnd(659.5, 677.418)).toBe(false);
  });

  it('is true past duration (dash can clamp currentTime above duration)', () => {
    expect(isNearEnd(678, 677.418)).toBe(true);
  });

  it('honours a custom threshold', () => {
    expect(isNearEnd(675, 677.418, 3)).toBe(true);
    expect(isNearEnd(675, 677.418, 1)).toBe(false);
  });

  it('is false for non-finite or zero-length media', () => {
    expect(isNearEnd(NaN, 100)).toBe(false);
    expect(isNearEnd(10, NaN)).toBe(false);
    expect(isNearEnd(null, 100)).toBe(false);
    expect(isNearEnd(0, 0)).toBe(false);
    expect(isNearEnd(5, -1)).toBe(false);
  });

  it('exports the threshold the prior audits standardised on', () => {
    expect(NEAR_END_THRESHOLD_SECONDS).toBe(0.5);
  });
});
