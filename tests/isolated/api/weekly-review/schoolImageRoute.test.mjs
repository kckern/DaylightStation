// tests/isolated/api/weekly-review/schoolImageRoute.test.mjs
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createWeeklyReviewRouter } from "../../../../__app_modules/personal/weekly-review/server/api/weekly-review.mjs";

function mountApp(getSchoolImage) {
  const weeklyReviewService = { getSchoolImage: vi.fn(getSchoolImage) };
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const app = express();
  app.use('/api/v1/weekly-review', createWeeklyReviewRouter({ weeklyReviewService, logger }));
  return { app, weeklyReviewService, logger };
}

describe('GET /api/v1/weekly-review/school/image', () => {
  it.each([
    ['missing ref', ''],
    ['unknown prefix', '?ref=book%3A123'],
    ['path traversal chars', '?ref=course%3A..%5Cetc'],
    ['empty id', '?ref=course%3A'],
  ])('rejects %s with 400', async (_label, query) => {
    const { app, weeklyReviewService } = mountApp(async () => null);
    const res = await request(app).get(`/api/v1/weekly-review/school/image${query}`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'bad-ref' });
    expect(weeklyReviewService.getSchoolImage).not.toHaveBeenCalled();
  });

  it('returns 404 when the service has no image', async () => {
    const { app, weeklyReviewService } = mountApp(async () => null);
    const res = await request(app).get('/api/v1/weekly-review/school/image?ref=activity%3Aiss-42');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not-found' });
    expect(weeklyReviewService.getSchoolImage).toHaveBeenCalledWith('activity:iss-42');
  });

  it('sends the bytes with content type and a private cache header', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const { app } = mountApp(async () => ({ bytes, contentType: 'image/png' }));
    const res = await request(app).get('/api/v1/weekly-review/school/image?ref=course%3Aabc');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^image\/png/);
    expect(res.headers['cache-control']).toBe('private, max-age=86400');
    expect(Buffer.compare(res.body, bytes)).toBe(0);
  });

  it('answers 500 and logs when the service throws', async () => {
    const { app, logger } = mountApp(async () => { throw new Error('disk gone'); });
    const res = await request(app).get('/api/v1/weekly-review/school/image?ref=course%3Aabc');
    expect(res.status).toBe(500);
    expect(logger.error).toHaveBeenCalledWith('weekly-review.api.school-image.error', expect.objectContaining({ error: 'disk gone' }));
  });
});
