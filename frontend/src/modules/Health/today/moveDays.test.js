import { describe, it, expect } from 'vitest';
import { addDaysISO, dayLabel, recentDays, dayDropId, dayFromDropId } from './moveDays.js';

describe('moveDays', () => {
  it('names the nearest days and dates the rest', () => {
    expect(dayLabel('2026-09-28', '2026-09-28')).toBe('Today');
    expect(dayLabel('2026-09-27', '2026-09-28')).toBe('Yesterday');
    expect(dayLabel('2026-09-25', '2026-09-28')).toBe('Fri, Sep 25');
  });
  it('offers the week ending today, newest first, without the viewed day', () => {
    expect(recentDays('2026-09-28', '2026-09-28')).toEqual(['2026-09-27', '2026-09-26', '2026-09-25', '2026-09-24', '2026-09-23', '2026-09-22']);
    expect(recentDays('2026-09-28', '2026-09-27')[0]).toBe('2026-09-28');
    expect(recentDays('2026-09-28', '2026-09-27')).not.toContain('2026-09-27');
  });
  it('steps across a month and a DST edge without slipping a day', () => {
    expect(addDaysISO('2026-10-01', -1)).toBe('2026-09-30');
    expect(addDaysISO('2026-11-02', -1)).toBe('2026-11-01');
    expect(addDaysISO('2026-03-09', -1)).toBe('2026-03-08');
  });
  it('a drop id round-trips, and a meal id is not a day', () => {
    expect(dayFromDropId(dayDropId('2026-09-27'))).toBe('2026-09-27');
    expect(dayFromDropId('afternoon')).toBeNull();
  });
});
