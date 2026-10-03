/**
 * GET /api/v1/media/suggestions (docs/reference/media/media-app-technical.md §2.9).
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createMediaHouseRouter } from './mediaHouse.mjs';

describe('suggestions API', () => {
  it('passes ?deviceId=, else the X-Daylight-Device header, and returns the rows', async () => {
    const suggestions = { suggest: vi.fn(async ({ deviceId }) => ({ deviceId, generatedAt: 't', rows: [], empty: true })) };
    const app = express();
    app.use('/api/v1/media', createMediaHouseRouter({ suggestions }));
    const byQuery = await request(app).get('/api/v1/media/suggestions?deviceId=fleet:livingroom-tv');
    expect(byQuery.body).toEqual({ deviceId: 'fleet:livingroom-tv', generatedAt: 't', rows: [], empty: true });
    await request(app).get('/api/v1/media/suggestions').set('X-Daylight-Device', 'browser:abc');
    expect(suggestions.suggest).toHaveBeenLastCalledWith({ householdId: undefined, deviceId: 'browser:abc' });
    await request(app).get('/api/v1/media/suggestions?household=h2');
    expect(suggestions.suggest).toHaveBeenLastCalledWith({ householdId: 'h2', deviceId: null });
  });
  it('400 on a device id that is not a screen id (never reaches the cache)', async () => {
    const suggestions = { suggest: vi.fn() };
    const app = express();
    app.use('/api/v1/media', createMediaHouseRouter({ suggestions }));
    for (const bad of ['livingroom-tv', 'browser:', `browser:${'x'.repeat(97)}`, 'browser:a b', 'ephemeral:abc']) {
      const res = await request(app).get(`/api/v1/media/suggestions?deviceId=${encodeURIComponent(bad)}`);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_SCREEN_ID');
    }
    const header = await request(app).get('/api/v1/media/suggestions').set('X-Daylight-Device', 'ua:Mozilla');
    expect(header.status).toBe(400);
    expect(suggestions.suggest).not.toHaveBeenCalled();
  });

  it('501 when not wired', async () => {
    const app = express();
    app.use('/api/v1/media', createMediaHouseRouter({}));
    expect((await request(app).get('/api/v1/media/suggestions')).status).toBe(501);
  });
});
