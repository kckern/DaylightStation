// tests/unit/api/routers/lifelog.test.mjs
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// Mock the LifelogAggregator
const mockAggregator = {
  aggregate: jest.fn()
};

describe('lifelog router', () => {
  let app;

  beforeEach(async () => {
    jest.resetModules();
    const { createLifelogRouter } = await import('../../../../backend/src/4_api/routers/lifelog.mjs');
    app = express();
    app.use('/lifelog', createLifelogRouter({ aggregator: mockAggregator }));
  });

  it('should return 200 with aggregated data for valid date', async () => {
    mockAggregator.aggregate.mockResolvedValue({
      date: '2026-01-13',
      sources: { weight: { lbs: 180 } },
      summaries: [{ source: 'weight', text: 'WEIGHT: 180 lbs' }],
      summaryText: '## WEIGHT\n180 lbs'
    });

    const res = await request(app).get('/lifelog/aggregate/testuser/2026-01-13');
    expect(res.status).toBe(200);
    expect(res.body.date).toBe('2026-01-13');
    expect(mockAggregator.aggregate).toHaveBeenCalledWith('testuser', '2026-01-13');
  });

  it('should return 400 for invalid date format', async () => {
    const res = await request(app).get('/lifelog/aggregate/testuser/invalid-date');
    expect(res.status).toBe(400);
  });
});
