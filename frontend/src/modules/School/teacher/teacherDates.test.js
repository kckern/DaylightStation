import { describe, expect, it } from 'vitest';
import { humanDate, humanDateTime, teacherTime, localDay, teacherDate } from './teacherDates.js';

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
