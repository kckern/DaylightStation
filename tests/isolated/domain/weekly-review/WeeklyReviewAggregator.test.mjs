// tests/isolated/domain/weekly-review/WeeklyReviewAggregator.test.mjs
import { describe, it, expect } from '@jest/globals';
import { WeeklyReviewAggregator } from '../../../../backend/src/2_domains/weekly-review/WeeklyReviewAggregator.mjs';

describe('WeeklyReviewAggregator', () => {
  const PHOTO_DAYS = [
    { date: '2026-03-23', photos: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }], photoCount: 3, sessions: [{ index: 0, count: 3 }] },
    { date: '2026-03-24', photos: [{ id: 'p4' }], photoCount: 1, sessions: [{ index: 0, count: 1 }] },
    { date: '2026-03-25', photos: [], photoCount: 0, sessions: [] },
    { date: '2026-03-26', photos: Array.from({ length: 12 }, (_, i) => ({ id: `p${10 + i}` })), photoCount: 12, sessions: [] },
    { date: '2026-03-27', photos: [], photoCount: 0, sessions: [] },
    { date: '2026-03-28', photos: [{ id: 'p30' }, { id: 'p31' }], photoCount: 2, sessions: [] },
    { date: '2026-03-29', photos: [{ id: 'p40' }], photoCount: 1, sessions: [] },
    { date: '2026-03-30', photos: [], photoCount: 0, sessions: [] },
  ];

  const CALENDAR_EVENTS = [
    { date: '2026-03-23', events: [{ summary: 'Soccer', time: '10:00', calendar: 'family' }] },
    { date: '2026-03-28', events: [{ summary: 'Birthday Party', time: '14:00', calendar: 'family' }] },
  ];

  describe('aggregate', () => {
    it('merges photos and calendar into 8-day structure', () => {
      const result = WeeklyReviewAggregator.aggregate(PHOTO_DAYS, CALENDAR_EVENTS);
      expect(result.days.length).toBe(8);
      expect(result.days[0].date).toBe('2026-03-23');
      expect(result.days[0].calendar).toEqual([{ summary: 'Soccer', time: '10:00', calendar: 'family' }]);
      expect(result.days[0].photos.length).toBe(3);
    });

    it('assigns column weights proportional to content density', () => {
      const result = WeeklyReviewAggregator.aggregate(PHOTO_DAYS, CALENDAR_EVENTS);
      const mar26Weight = result.days.find(d => d.date === '2026-03-26').columnWeight;
      const mar25Weight = result.days.find(d => d.date === '2026-03-25').columnWeight;
      expect(mar26Weight).toBeGreaterThan(mar25Weight);
    });

    it('gives empty days a minimum weight so they remain visible', () => {
      const result = WeeklyReviewAggregator.aggregate(PHOTO_DAYS, CALENDAR_EVENTS);
      const emptyDay = result.days.find(d => d.date === '2026-03-25');
      expect(emptyDay.columnWeight).toBeGreaterThan(0);
    });

    it('days without calendar events get empty array', () => {
      const result = WeeklyReviewAggregator.aggregate(PHOTO_DAYS, CALENDAR_EVENTS);
      const mar24 = result.days.find(d => d.date === '2026-03-24');
      expect(mar24.calendar).toEqual([]);
    });
  });
});
