// tests/isolated/domain/notification/quiet-hours.test.mjs
import { describe, it, expect } from 'vitest';
import { QuietHours } from '#domains/notification/value-objects/QuietHours.mjs';

const at = (h, m = 0) => { const d = new Date(2026, 6, 17, h, m, 0); return d; };

describe('QuietHours.isWithin', () => {
  it('is never within when disabled', () => {
    expect(new QuietHours({ enabled: false, start: '21:00', end: '07:00' }).isWithin(at(23))).toBe(false);
  });
  it('handles an overnight window (21:00 -> 07:00)', () => {
    const q = new QuietHours({ enabled: true, start: '21:00', end: '07:00' });
    expect(q.isWithin(at(23))).toBe(true);   // late night
    expect(q.isWithin(at(3))).toBe(true);    // early morning
    expect(q.isWithin(at(12))).toBe(false);  // midday
    expect(q.isWithin(at(7))).toBe(false);   // end is exclusive
    expect(q.isWithin(at(21))).toBe(true);   // start is inclusive
  });
  it('handles a same-day window (13:00 -> 14:00)', () => {
    const q = new QuietHours({ enabled: true, start: '13:00', end: '14:00' });
    expect(q.isWithin(at(13, 30))).toBe(true);
    expect(q.isWithin(at(12, 59))).toBe(false);
  });
  it('treats a degenerate start===end window as never within', () => {
    expect(new QuietHours({ enabled: true, start: '09:00', end: '09:00' }).isWithin(at(9))).toBe(false);
  });
});
