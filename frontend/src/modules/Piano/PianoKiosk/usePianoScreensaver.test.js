import { describe, it, expect } from 'vitest';
import { isWithinQuietHours } from './usePianoScreensaver.jsx';

const at = (h, m = 0) => { const d = new Date(2026, 5, 22, h, m, 0); return d; };

describe('isWithinQuietHours', () => {
  it('returns false when quietHours is unset or malformed', () => {
    expect(isWithinQuietHours(at(23), null)).toBe(false);
    expect(isWithinQuietHours(at(23), {})).toBe(false);
    expect(isWithinQuietHours(at(23), { start: 'oops', end: '07:00' })).toBe(false);
    expect(isWithinQuietHours(at(23), { start: '21:00', end: '21:00' })).toBe(false);
  });

  it('handles overnight ranges (start > end)', () => {
    const q = { start: '21:30', end: '07:00' };
    expect(isWithinQuietHours(at(22), q)).toBe(true);   // after start
    expect(isWithinQuietHours(at(2), q)).toBe(true);    // before end (next day)
    expect(isWithinQuietHours(at(21, 30), q)).toBe(true); // inclusive start
    expect(isWithinQuietHours(at(7), q)).toBe(false);   // exclusive end
    expect(isWithinQuietHours(at(12), q)).toBe(false);  // midday
    expect(isWithinQuietHours(at(21, 0), q)).toBe(false); // just before start
  });

  it('handles same-day ranges (start < end)', () => {
    const q = { start: '09:00', end: '17:00' };
    expect(isWithinQuietHours(at(12), q)).toBe(true);
    expect(isWithinQuietHours(at(9), q)).toBe(true);    // inclusive start
    expect(isWithinQuietHours(at(17), q)).toBe(false);  // exclusive end
    expect(isWithinQuietHours(at(8, 59), q)).toBe(false);
    expect(isWithinQuietHours(at(23), q)).toBe(false);
  });
});
