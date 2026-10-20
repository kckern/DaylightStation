import { describe, it, expect } from 'vitest';
import {
  recentlyRead, noRepeatWindowDays, validateStoryTimeEnrollment, DEFAULT_STORY_NO_REPEAT_DAYS,
  suggestStories, STORY_SUGGESTION_LIMIT,
} from '../../../../__app_modules/learning/school/server/domain/storyTime.mjs';

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

describe('suggestStories', () => {
  // Thursday 10-08, N=4: the window is 10-05..10-08.
  const TODAY = '2026-10-08';
  const book = (contentId, title = null) => ({ contentId, title });
  const row = (studyDay, contentId, title = null) => ({ studyDay, contentId, title });
  const suggest = (extra) => suggestStories({ today: TODAY, noRepeatDays: 4, ...extra });

  it('the limit is three', () => expect(STORY_SUGGESTION_LIMIT).toBe(3));

  it('leaves out every book read inside the window, and the refused book itself', () => {
    const corpus = [book('a', 'A'), book('b', 'B'), book('c', 'C'), book('d', 'D')];
    const reads = [row('2026-10-07', 'a'), row('2026-10-05', 'b')];
    expect(suggest({ corpus, reads, exclude: 'c' }).map((s) => s.contentId)).toEqual(['d']);
  });

  it('never-read first, then least-recently read; within a tier by the daily rotation', () => {
    const corpus = [book('old', 'Zebra'), book('older', 'Apple'), book('n2', 'Moon'), book('n1', 'Moon'), book('n0', 'Ant')];
    const reads = [row('2026-10-03', 'old'), row('2026-09-20', 'older'), row('2026-10-01', 'older')];
    const got = suggest({ corpus, reads, learnerId: 'kid', limit: 5 }).map((s) => s.contentId);
    expect(got.slice(0, 3).sort()).toEqual(['n0', 'n1', 'n2']);
    expect(got.slice(3)).toEqual(['older', 'old']);
  });

  describe('daily rotation', () => {
    const shelf = Array.from({ length: 20 }, (_, i) => book(`plex:${i}`, `Book ${String(i).padStart(2, '0')}`));
    const on = (today, learnerId = 'kid') => suggestStories({ corpus: shelf, reads: [], today, noRepeatDays: 4, learnerId })
      .map((s) => s.contentId);

    it('the same day and child give the same three, every time', () => {
      expect(on('2026-10-08')).toEqual(on('2026-10-08'));
      expect(on('2026-10-08')).toHaveLength(3);
    });

    it('the next day gives a different order', () => {
      expect(on('2026-10-09')).not.toEqual(on('2026-10-08'));
    });

    it('is not the alphabetical first three', () => {
      const days = ['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'];
      const seen = new Set(days.flatMap((d) => on(d)));
      expect(seen.size).toBeGreaterThan(3);
    });

    it('ties among books last read the same day rotate too, after older reads', () => {
      const reads = [row('2026-09-01', 'plex:0'), ...shelf.slice(1).map((b) => row('2026-09-10', b.contentId))];
      const got = suggestStories({ corpus: shelf, reads, today: '2026-10-08', noRepeatDays: 4, learnerId: 'kid' });
      expect(got[0].contentId).toBe('plex:0');
    });
  });

  it('gives at most three', () => {
    const corpus = ['a', 'b', 'c', 'd', 'e'].map((id) => book(id, id));
    expect(suggest({ corpus, reads: [] })).toHaveLength(3);
  });

  it('an empty corpus suggests nothing', () => {
    expect(suggest({ corpus: [], reads: [row('2026-09-01', 'a', 'A')] })).toEqual([]);
  });

  it("prefers the reading log's title over the corpus label, and says when it was last read", () => {
    const corpus = [book('plex:1', 'Eyes shuts')];
    const reads = [row('2026-09-30', 'plex:1', 'I Can Read with My Eyes Shut!')];
    expect(suggest({ corpus, reads })).toEqual([
      { contentId: 'plex:1', title: 'I Can Read with My Eyes Shut!', lastReadOn: '2026-09-30' },
    ]);
  });

  it('with no corpus at all, falls back to the books in the history outside the window', () => {
    const reads = [row('2026-10-07', 'a', 'A'), row('2026-09-28', 'b', 'B'), row('2026-09-28', 'b', 'B')];
    expect(suggest({ corpus: null, reads })).toEqual([{ contentId: 'b', title: 'B', lastReadOn: '2026-09-28' }]);
  });

  it('drops corpus entries with no id and duplicates', () => {
    expect(suggest({ corpus: [book(null, 'X'), book('a', 'A'), book('a', 'A again')], reads: [] }))
      .toEqual([{ contentId: 'a', title: 'A', lastReadOn: null }]);
  });
});
