import { describe, it, expect } from 'vitest';
import {
  recentlyRead, noRepeatWindowDays, validateStoryTimeEnrollment, DEFAULT_STORY_NO_REPEAT_DAYS,
} from '#domains/school/storyTime.mjs';

const BOOK = 'plex:621568';
const read = (studyDay, contentId = BOOK) => ({ studyDay, contentId });
// 2026-10-05 is a Monday. Window with N=4 on Thursday 10-08: 10-05..10-08.
const check = (reads, today, noRepeatDays = 4, contentId = BOOK) => recentlyRead({ reads, contentId, today, noRepeatDays });

describe('recentlyRead', () => {
  it('default is 4', () => expect(DEFAULT_STORY_NO_REPEAT_DAYS).toBe(4));

  it('N-1 days ago is recent (Mon read blocks Thu)', () => {
    expect(check([read('2026-10-05')], '2026-10-08')).toEqual({ recent: true, lastReadOn: '2026-10-05' });
  });
  it('N days ago is allowed again (Mon read allows Fri)', () => {
    expect(check([read('2026-10-05')], '2026-10-09')).toEqual({ recent: false, lastReadOn: null });
  });
  it("today's earlier read counts", () => {
    expect(check([read('2026-10-09')], '2026-10-09')).toEqual({ recent: true, lastReadOn: '2026-10-09' });
  });
  it('reports the most recent in-window read', () => {
    expect(check([read('2026-10-06'), read('2026-10-08')], '2026-10-09').lastReadOn).toBe('2026-10-08');
  });
  it('a different book is unaffected', () => {
    expect(check([read('2026-10-08', 'plex:1')], '2026-10-09').recent).toBe(false);
  });
  it('an abandoned read leaves no row, so nothing is recent', () => {
    expect(check([], '2026-10-09').recent).toBe(false);
  });
  it('0 disables the rule', () => {
    expect(check([read('2026-10-09')], '2026-10-09', 0).recent).toBe(false);
  });
  it('N=1 means only today', () => {
    expect(check([read('2026-10-08')], '2026-10-09', 1).recent).toBe(false);
    expect(check([read('2026-10-09')], '2026-10-09', 1).recent).toBe(true);
  });
  it('missing history or contentId fails open', () => {
    expect(recentlyRead({ reads: undefined, contentId: BOOK, today: '2026-10-09', noRepeatDays: 4 }).recent).toBe(false);
    expect(recentlyRead({ reads: [read('2026-10-09')], contentId: null, today: '2026-10-09', noRepeatDays: 4 }).recent).toBe(false);
    expect(recentlyRead({ reads: [read('2026-10-09')], contentId: BOOK, today: 'garbage', noRepeatDays: 4 }).recent).toBe(false);
  });
  it('window crosses a month boundary', () => {
    expect(noRepeatWindowDays('2026-11-02', 4)).toEqual(['2026-11-02', '2026-11-01', '2026-10-31', '2026-10-30']);
  });
});

describe('story-time noRepeatDays validation', () => {
  const v = (extra) => validateStoryTimeEnrollment({ programId: 'story-time', ...extra });
  it('accepts a non-negative integer, including 0, and keeps it', () => {
    expect(v({ noRepeatDays: 0 }).enrollment.noRepeatDays).toBe(0);
    expect(v({ noRepeatDays: 7 }).enrollment.noRepeatDays).toBe(7);
  });
  it('absent stays absent (default applies at read time)', () => {
    expect(v({}).enrollment).not.toHaveProperty('noRepeatDays');
  });
  it.each([-1, 1.5, '4', 1000])('refuses %s', (bad) => {
    expect(v({ noRepeatDays: bad }).errors[0]).toMatch(/noRepeatDays/);
  });
});
