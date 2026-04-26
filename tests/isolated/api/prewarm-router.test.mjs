import { describe, test, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createPrewarmRouter } from '../../../backend/src/4_api/v1/routers/prewarm.mjs';

describe('prewarm router', () => {
  const mockPrewarmService = {
    redeem: vi.fn()
  };

  const app = express();
  app.use('/api/v1/prewarm', createPrewarmRouter({
    prewarmService: mockPrewarmService
  }));

  test('GET /:token returns DASH URL for valid token', async () => {
    mockPrewarmService.redeem.mockReturnValue('/api/v1/proxy/plex/video/start.mpd?session=abc');

    const res = await request(app).get('/api/v1/prewarm/abc123');
    expect(res.status).toBe(200);
    expect(res.body.url).toBe('/api/v1/proxy/plex/video/start.mpd?session=abc');
  });

  test('GET /:token returns 404 for unknown/expired token', async () => {
    mockPrewarmService.redeem.mockReturnValue(null);

    const res = await request(app).get('/api/v1/prewarm/bogus');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });
});
