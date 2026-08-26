import { describe, expect, it } from 'vitest';
import { humanDate, humanDateTime, teacherTime, localDay, teacherDate, shiftDay } from './teacherDates.js';

describe('teacherDates — the module-wide formatters', () => {
  it('humanDate anchors bare days at noon and pins en-US', () => {
    expect(humanDate('2026-08-25')).toBe('Tuesday, Aug 25');
    expect(humanDate('garbage')).toBeNull();
  });

  it('humanDateTime formats timestamps', () => {
    expect(humanDateTime('2026-08-24T15:20:00')).toMatch(/Aug 24, 2026/);
    expect(humanDateTime(null)).toBeNull();
  });

  it('teacherTime gives time-of-day only', () => {
    expect(teacherTime('2026-08-24T15:20:00')).toMatch(/3:20/);
    expect(teacherTime('nope')).toBeNull();
  });

  it('localDay uses local time, never UTC', () => {
    const d = new Date(2026, 7, 24, 21, 30); // 9:30pm local, Aug 24
    expect(localDay(d)).toBe('2026-08-24');
  });

  it('teacherDate stays the storage-safe day label', () => {
    expect(teacherDate('2026-08-24')).toBe('Aug 24, 2026');
  });
});

describe('shiftDay', () => {
  it('moves forward a day', () => {
    expect(shiftDay('2026-08-25', 1)).toBe('2026-08-26');
  });
  it('moves backward a day', () => {
    expect(shiftDay('2026-08-25', -1)).toBe('2026-08-24');
  });
  it('crosses a month boundary', () => {
    expect(shiftDay('2026-08-31', 1)).toBe('2026-09-01');
  });
  it('crosses a year boundary backwards', () => {
    expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31');
  });
  it('crosses a US spring-forward DST boundary without losing a day', () => {
    expect(shiftDay('2026-03-08', 1)).toBe('2026-03-09');
  });
  it('returns null for garbage', () => {
    expect(shiftDay('not-a-day', 1)).toBeNull();
    expect(shiftDay(null, 1)).toBeNull();
  });
});
