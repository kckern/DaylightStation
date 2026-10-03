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
  it('501 when not wired', async () => {
    const app = express();
    app.use('/api/v1/media', createMediaHouseRouter({}));
    expect((await request(app).get('/api/v1/media/suggestions')).status).toBe(501);
  });
});
