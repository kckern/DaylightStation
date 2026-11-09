// The weekly-review window across a DST change, and today's place in it.
// The container runs TZ=America/Los_Angeles; on the Sunday after "fall back"
// (2026-11-08) the grid ended at Friday: Saturday was dropped by a local-time
// day loop, and today was excluded by design.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WeeklyReviewService } from "../../../../__app_modules/personal/weekly-review/server/application/WeeklyReviewService.mjs";
import { WeeklyReviewImmichAdapter } from "../../../../__app_modules/personal/weekly-review/server/adapters/WeeklyReviewImmichAdapter.mjs";
import { WeeklyReviewCalendarAdapter } from "../../../../__app_modules/personal/weekly-review/server/adapters/WeeklyReviewCalendarAdapter.mjs";

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
let savedTz;
beforeEach(() => { savedTz = process.env.TZ; process.env.TZ = 'America/Los_Angeles'; });
afterEach(() => { process.env.TZ = savedTz; vi.useRealTimers(); });

describe('Immich adapter across "fall back"', () => {
  it('returns every day start..end inclusive, the last one included', async () => {
    const adapter = new WeeklyReviewImmichAdapter({}, { client: { searchMetadata: vi.fn().mockResolvedValue({ items: [] }) }, logger });
    const days = await adapter.getPhotosForDateRange('2026-10-31', '2026-11-07');
    expect(days.map((d) => d.date)).toEqual(['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']);
  });
  it('and across "spring forward"', async () => {
    const adapter = new WeeklyReviewImmichAdapter({}, { client: { searchMetadata: vi.fn().mockResolvedValue({ items: [] }) }, logger });
    const days = await adapter.getPhotosForDateRange('2026-03-07', '2026-03-10');
    expect(days.map((d) => d.date)).toEqual(['2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10']);
  });
});

describe('calendar adapter across "fall back"', () => {
  it('reads the last day of the lifelog range too', async () => {
    const lifelog = {
      '2026-11-06': [{ summary: 'Practice', start: { dateTime: '2026-11-06T17:00:00-08:00' }, end: { dateTime: '2026-11-06T18:00:00-08:00' } }],
      '2026-11-07': [{ summary: 'Party', start: { dateTime: '2026-11-07T18:00:00-08:00' }, end: { dateTime: '2026-11-07T20:00:00-08:00' } }],
    };
    const adapter = new WeeklyReviewCalendarAdapter({ defaultUser: 'u' }, { loadLifelogCalendar: () => lifelog, logger });
    const out = await adapter.getEventsForDateRange('2026-10-31', '2026-11-07');
    expect(out.map((d) => d.date)).toEqual(['2026-11-06', '2026-11-07']);
  });
});

function service(store, immich) {
  return new WeeklyReviewService({ timezone: 'America/Los_Angeles', dataPath: '/tmp/wr-test', mediaPath: '/tmp/wr-test' }, {
    reviewStore: store, runCommand: vi.fn(async () => ({})), immichAdapter: immich,
    calendarData: { getEventsForDateRange: vi.fn().mockResolvedValue([]) },
    transcriptionService: {}, logger,
  });
}
const store = (keys) => ({
  getRecordingStatus: (week) => (keys.includes(week) ? { exists: true, recordedAt: 'x', duration: 326 } : { exists: false }),
  listDrafts: () => [], sweepStaleDrafts: async () => [], listAllDrafts: () => [],
});

describe('default window', () => {
  it('is the last 8 days INCLUDING today, in the household timezone', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-09T03:43:00Z')); // Sunday 2026-11-08 19:43 PST
    const immich = { getPhotosForDateRange: vi.fn().mockResolvedValue([]) };
    const result = await service(store([]), immich).bootstrap();
    expect(immich.getPhotosForDateRange).toHaveBeenCalledWith('2026-11-01', '2026-11-08');
    expect(result.week).toBe('2026-11-01');
  });

  it('still shows a review recorded today under the old [today-8, today-1] key', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-09T03:43:00Z'));
    const immich = { getPhotosForDateRange: vi.fn().mockResolvedValue([]) };
    const result = await service(store(['2026-10-31']), immich).bootstrap();
    expect(result.recording).toMatchObject({ exists: true, duration: 326, legacyWeek: '2026-10-31' });
    const exact = await service(store(['2026-11-01', '2026-10-31']), immich).bootstrap();
    expect(exact.recording.legacyWeek).toBeUndefined();
  });
});
