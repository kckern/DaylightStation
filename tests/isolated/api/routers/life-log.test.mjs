import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import createLogRouter from '#api/v1/routers/life/log.mjs';

describe('Life Log API Router', () => {
  let app;
  let mockAggregator;

  const singleDayResult = {
    date: '2025-06-15',
    sources: { strava: { distance: 5000 }, calendar: { events: 2 } },
    categories: { fitness: { strava: { distance: 5000 } }, calendar: { calendar: { events: 2 } } },
    summaries: [
      { source: 'strava', category: 'fitness', text: 'Ran 5km' },
      { source: 'calendar', category: 'calendar', text: '2 events' },
    ],
    summaryText: 'Ran 5km\n\n2 events',
    _meta: { username: 'testuser', date: '2025-06-15', availableSourceCount: 2, sources: ['strava', 'calendar'] },
  };

  const rangeResult = {
    startDate: '2025-06-14',
    endDate: '2025-06-15',
    days: {
      '2025-06-14': { sources: { strava: { distance: 3000 } }, categories: {}, summaries: [] },
      '2025-06-15': { sources: { strava: { distance: 5000 } }, categories: {}, summaries: [] },
    },
    _meta: { username: 'testuser', dayCount: 2, availableSources: ['strava'] },
  };

  beforeEach(() => {
    mockAggregator = {
      aggregate: vi.fn().mockResolvedValue(singleDayResult),
      aggregateRange: vi.fn().mockResolvedValue(rangeResult),
      getAvailableSources: vi.fn().mockReturnValue(['strava', 'calendar', 'weight', 'github']),
    };

    const router = createLogRouter({ aggregator: mockAggregator });

    app = express();
    app.use(express.json());
    app.use('/log', router);
  });

  describe('GET /log/:username/:date', () => {
    it('returns aggregated data for a single day', async () => {
      const res = await request(app).get('/log/testuser/2025-06-15');
      expect(res.status).toBe(200);
      expect(res.body.date).toBe('2025-06-15');
      expect(res.body.sources.strava).toBeDefined();
      expect(mockAggregator.aggregate).toHaveBeenCalledWith('testuser', '2025-06-15');
    });

    it('rejects invalid date format', async () => {
      const res = await request(app).get('/log/testuser/not-a-date');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/date/i);
    });
  });

  describe('GET /log/:username/range', () => {
    it('returns data for a date range', async () => {
      const res = await request(app).get('/log/testuser/range?start=2025-06-14&end=2025-06-15');
      expect(res.status).toBe(200);
      expect(res.body.days).toBeDefined();
      expect(Object.keys(res.body.days)).toHaveLength(2);
      expect(mockAggregator.aggregateRange).toHaveBeenCalledWith('testuser', '2025-06-14', '2025-06-15');
    });

    it('rejects missing start/end params', async () => {
      const res = await request(app).get('/log/testuser/range?start=2025-06-14');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/start.*end/i);
    });
  });

  describe('GET /log/:username/scope/:scope', () => {
    it('resolves week scope to 7-day range', async () => {
      const res = await request(app).get('/log/testuser/scope/week');
      expect(res.status).toBe(200);
      expect(mockAggregator.aggregateRange).toHaveBeenCalled();
      const [, start, end] = mockAggregator.aggregateRange.mock.calls[0];
      const days = Math.round((new Date(end) - new Date(start)) / 86400000);
      expect(days).toBe(6); // 7 days inclusive
    });

    it('resolves month scope to 30-day range', async () => {
      const res = await request(app).get('/log/testuser/scope/month');
      expect(res.status).toBe(200);
      const [, start, end] = mockAggregator.aggregateRange.mock.calls[0];
      const days = Math.round((new Date(end) - new Date(start)) / 86400000);
      expect(days).toBe(29); // 30 days inclusive
    });

    it('resolves season scope to 90-day range', async () => {
      const res = await request(app).get('/log/testuser/scope/season');
      expect(res.status).toBe(200);
      const [, start, end] = mockAggregator.aggregateRange.mock.calls[0];
      const days = Math.round((new Date(end) - new Date(start)) / 86400000);
      expect(days).toBe(89); // 90 days inclusive
    });

    it('supports at= parameter for specific period', async () => {
      const res = await request(app).get('/log/testuser/scope/month?at=2025-06');
      expect(res.status).toBe(200);
      const [, start, end] = mockAggregator.aggregateRange.mock.calls[0];
      expect(start).toBe('2025-06-01');
      expect(end).toBe('2025-06-30');
    });

    it('rejects invalid scope', async () => {
      const res = await request(app).get('/log/testuser/scope/invalid');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/scope/i);
    });
  });

  describe('GET /log/:username/category/:category', () => {
    it('returns category-filtered data for default range', async () => {
      const res = await request(app).get('/log/testuser/category/fitness');
      expect(res.status).toBe(200);
      expect(mockAggregator.aggregateRange).toHaveBeenCalled();
    });

    it('accepts start/end query params', async () => {
      const res = await request(app).get('/log/testuser/category/fitness?start=2025-06-01&end=2025-06-15');
      expect(res.status).toBe(200);
      expect(mockAggregator.aggregateRange).toHaveBeenCalledWith('testuser', '2025-06-01', '2025-06-15');
    });

    it('accepts scope query param', async () => {
      const res = await request(app).get('/log/testuser/category/fitness?scope=week');
      expect(res.status).toBe(200);
      expect(mockAggregator.aggregateRange).toHaveBeenCalled();
    });
  });

  describe('GET /log/sources', () => {
    it('returns available extractor sources', async () => {
      const res = await request(app).get('/log/sources');
      expect(res.status).toBe(200);
      expect(res.body.sources).toEqual(['strava', 'calendar', 'weight', 'github']);
    });
  });
});
