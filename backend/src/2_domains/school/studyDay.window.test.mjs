import { describe, it, expect } from 'vitest';
import { studyDayWindow, withinStudyWindow } from './studyDay.mjs';

describe('studyDayWindow', () => {
  it('rolls at the 4am boundary, not midnight (UTC household)', () => {
    const at0330 = Date.parse('2026-08-06T03:30:00Z');
    const w = studyDayWindow(at0330, { timezone: null });
    expect(new Date(w.startAtMs).toISOString()).toBe('2026-08-05T04:00:00.000Z');
    expect(w.endAtMs - w.startAtMs).toBe(86_400_000);
  });

  it('after the roll, the window starts today 4am', () => {
    const at0430 = Date.parse('2026-08-06T04:30:00Z');
    const w = studyDayWindow(at0430, { timezone: null });
    expect(new Date(w.startAtMs).toISOString()).toBe('2026-08-06T04:00:00.000Z');
  });

  it('applies the household timezone offset', () => {
    // 2026-08-06T05:00Z = 2026-08-05T22:00 in America/Los_Angeles (UTC-7):
    // before LA's Aug-6 4am boundary, so the window starts Aug 5 04:00 LA
    // = Aug 5 11:00Z.
    const w = studyDayWindow(Date.parse('2026-08-06T05:00:00Z'), { timezone: 'America/Los_Angeles' });
    expect(new Date(w.startAtMs).toISOString()).toBe('2026-08-05T11:00:00.000Z');
  });

  it('honors a custom boundary hour', () => {
    const w = studyDayWindow(Date.parse('2026-08-06T05:30:00Z'), { timezone: null, boundaryHour: 6 });
    expect(new Date(w.startAtMs).toISOString()).toBe('2026-08-05T06:00:00.000Z');
  });
});

describe('withinStudyWindow', () => {
  const w = {
    startAtMs: Date.parse('2026-08-05T04:00:00Z'),
    endAtMs: Date.parse('2026-08-06T04:00:00Z'),
  };

  it('includes the start, excludes the end', () => {
    expect(withinStudyWindow('2026-08-05T04:00:00.000Z', w)).toBe(true);
    expect(withinStudyWindow('2026-08-06T04:00:00.000Z', w)).toBe(false);
  });

  it('accepts an instant strictly inside', () => {
    expect(withinStudyWindow('2026-08-05T23:59:00Z', w)).toBe(true);
  });

  it('rejects garbage without throwing', () => {
    expect(withinStudyWindow(null, w)).toBe(false);
    expect(withinStudyWindow(undefined, w)).toBe(false);
    expect(withinStudyWindow('not-a-date', w)).toBe(false);
    expect(withinStudyWindow(12345, w)).toBe(false);
  });
});
