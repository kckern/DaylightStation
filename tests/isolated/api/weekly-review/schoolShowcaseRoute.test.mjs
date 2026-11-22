// tests/isolated/api/weekly-review/schoolShowcaseRoute.test.mjs
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createWeeklyReviewRouter } from "../../../../__app_modules/personal/weekly-review/server/api/weekly-review.mjs";

function mountApp(getSchoolShowcase) {
  const weeklyReviewService = { getSchoolShowcase: vi.fn(getSchoolShowcase) };
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const app = express();
  app.use('/api/v1/weekly-review', createWeeklyReviewRouter({ weeklyReviewService, logger }));
  return { app, weeklyReviewService, logger };
}

describe('GET /api/v1/weekly-review/school/showcase', () => {
  it.each([
    ['missing week', ''],
    ['a malformed week', '?week=2026-3-23'],
    ['a path', '?week=..%2F..%2Fetc'],
    ['a repeated week', '?week=2026-03-23&week=2026-03-24'],
    ['an impossible date', '?week=2026-99-99'],
    ['a day past the month', '?week=2026-02-30'],
  ])('rejects %s with 400', async (_label, query) => {
    const { app, weeklyReviewService } = mountApp(async () => []);
    const res = await request(app).get(`/api/v1/weekly-review/school/showcase${query}`);
    expect(res.status).toBe(400);
    expect(weeklyReviewService.getSchoolShowcase).not.toHaveBeenCalled();
  });

  it('returns the showcases for the week', async () => {
    const showcases = [{ learnerId: 'kid-a', learnerName: 'Robin', bullets: ['Finished Holes'], images: ['/img/holes'], source: 'ai' }];
    const { app, weeklyReviewService, logger } = mountApp(async () => showcases);
    const res = await request(app).get('/api/v1/weekly-review/school/showcase?week=2026-03-23');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ showcases });
    expect(weeklyReviewService.getSchoolShowcase).toHaveBeenCalledWith('2026-03-23');
    expect(logger.info).toHaveBeenCalledWith('weekly-review.api.school-showcase.response', expect.objectContaining({ week: '2026-03-23', children: 1, sources: ['ai'] }));
  });

  it('answers 500 and logs when the service throws', async () => {
    const { app, logger } = mountApp(async () => { throw new Error('disk gone'); });
    const res = await request(app).get('/api/v1/weekly-review/school/showcase?week=2026-03-23');
    expect(res.status).toBe(500);
    expect(logger.error).toHaveBeenCalledWith('weekly-review.api.school-showcase.error', expect.objectContaining({ week: '2026-03-23', error: 'disk gone' }));
  });
});
