import { describe, it, expect } from 'vitest';
import { pickReportDate } from '#apps/nutribot/usecases/GenerateDailyReport.mjs';

describe('pickReportDate — /report always renders the latest report', () => {
  const TODAY = '2026-07-08';

  it('an explicit requested date always wins (even if today has logs)', () => {
    expect(pickReportDate({ requestedDate: '2026-07-02', today: TODAY, todayHasLogs: true, mostRecentLoggedDate: TODAY }))
      .toBe('2026-07-02');
  });

  it('uses today when today has logs', () => {
    expect(pickReportDate({ requestedDate: undefined, today: TODAY, todayHasLogs: true, mostRecentLoggedDate: TODAY }))
      .toBe(TODAY);
  });

  it('falls back to the most recent logged day when today is empty (the reported bug)', () => {
    // Prod 2026-07-08: nothing logged today, latest accepted meal is 2026-07-07.
    expect(pickReportDate({ requestedDate: undefined, today: TODAY, todayHasLogs: false, mostRecentLoggedDate: '2026-07-07' }))
      .toBe('2026-07-07');
  });

  it('stays on today when there are no logs at all (nothing to fall back to)', () => {
    expect(pickReportDate({ requestedDate: undefined, today: TODAY, todayHasLogs: false, mostRecentLoggedDate: null }))
      .toBe(TODAY);
  });

  it('never picks a future date if the most-recent value is somehow ahead of today', () => {
    expect(pickReportDate({ requestedDate: undefined, today: TODAY, todayHasLogs: false, mostRecentLoggedDate: '2026-07-10' }))
      .toBe(TODAY);
  });
});

import { mostRecentLoggedDate } from '#apps/nutribot/usecases/GenerateDailyReport.mjs';

describe('mostRecentLoggedDate — anchor by calendar date, not entry order (back-dating bug)', () => {
  const TODAY = '2026-07-08';

  it('returns the max meal.date even when a back-dated entry is listed first', () => {
    // Simulates: user back-dates a 06-27 meal today; store returns it first
    // (most-recently-entered). Anchor must still be the latest real day, 07-07.
    const logs = [
      { meal: { date: '2026-06-27' } }, // just back-logged, appears first
      { meal: { date: '2026-07-07' } },
      { meal: { date: '2026-07-04' } },
    ];
    expect(mostRecentLoggedDate(logs, TODAY)).toBe('2026-07-07');
  });

  it('ignores future-dated logs (never reports ahead of today)', () => {
    const logs = [{ meal: { date: '2026-07-10' } }, { meal: { date: '2026-07-05' } }];
    expect(mostRecentLoggedDate(logs, TODAY)).toBe('2026-07-05');
  });

  it('returns today when a log is dated today', () => {
    const logs = [{ meal: { date: '2026-07-02' } }, { meal: { date: TODAY } }];
    expect(mostRecentLoggedDate(logs, TODAY)).toBe(TODAY);
  });

  it('returns null when there are no dated logs', () => {
    expect(mostRecentLoggedDate([], TODAY)).toBeNull();
    expect(mostRecentLoggedDate([{ meal: {} }, {}], TODAY)).toBeNull();
  });
});
