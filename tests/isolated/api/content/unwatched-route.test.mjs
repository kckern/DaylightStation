// unwatched-route.test.mjs — show/season tiles and rows ask how many episodes
// the household has not finished (2026-11-27).
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createContentRouter } from "../../../../__capabilities/content-catalog/server/api/content.mjs";

function appWith(contentQueryService) {
  const app = express();
  app.use('/api/v1/content', createContentRouter({ contentQueryService }));
  return app;
}

describe('GET /api/v1/content/query/unwatched', () => {
  it('answers the counts for the asked ids', async () => {
    const unwatchedCounts = vi.fn(async () => ({ 'plex:1': { unwatched: 3, total: 18 } }));
    const res = await request(appWith({ unwatchedCounts })).get('/api/v1/content/query/unwatched?ids=plex:1,%20plex:2').expect(200);
    expect(unwatchedCounts).toHaveBeenCalledWith(['plex:1', 'plex:2']);
    expect(res.body).toEqual({ counts: { 'plex:1': { unwatched: 3, total: 18 } } });
  });
  it('requires ids', async () => {
    await request(appWith({ unwatchedCounts: vi.fn() })).get('/api/v1/content/query/unwatched').expect(400);
  });
});
