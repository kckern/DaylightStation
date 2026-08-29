import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createLocalRouter } from './local.mjs';
import { createDisplayRouter } from './display.mjs';
import { createInfoRouter } from './info.mjs';
import { createFeedRouter } from './feed.mjs';

const mounted = (path, router, { json = false } = {}) => {
  const app = express();
  if (json) app.use(express.json());
  app.use(path, router);
  return app;
};

describe('contract-preserving semantic router boundaries', () => {
  it('keeps local roots and search response envelopes unchanged', async () => {
    const localMediaCatalog = {
      roots: vi.fn().mockResolvedValue({ kind: 'found', value: [{ path: 'music' }] }),
      search: vi.fn().mockResolvedValue({ kind: 'found', value: [{ id: 'one' }] }),
    };
    const app = mounted('/local', createLocalRouter({ localMediaCatalog }));
    expect((await request(app).get('/local/roots')).body).toEqual({ roots: [{ path: 'music' }] });
    expect((await request(app).get('/local/search?q=beethoven')).body).toEqual({
      query: 'beethoven', results: [{ id: 'one' }], count: 1,
    });
    const head = await request(app).head('/local/roots');
    expect(head.status).toBe(200);
    expect(head.text).toBeUndefined();
  });

  it('keeps unavailable local search ahead of query validation', async () => {
    const app = mounted('/local', createLocalRouter({ localMediaCatalog: { available: false } }));
    const res = await request(app).get('/local/search?q=x');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'Local media adapter not configured' });
  });

  it('keeps display redirect status, location, and cache header unchanged', async () => {
    const contentAccessService = {
      display: vi.fn().mockResolvedValue({
        kind: 'found', source: 'plex', localId: '7', title: 'Work', thumbnailUrl: 'https://plex.local/thumb/7',
      }),
    };
    const res = await request(mounted('/display', createDisplayRouter({ contentAccessService })))
      .get('/display/plex:7');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/api/v1/proxy/plex/thumb/7');
    expect(res.headers['cache-control']).toBe('public, max-age=86400');
    const head = await request(mounted('/display', createDisplayRouter({ contentAccessService })))
      .head('/display/plex:7');
    expect(head.status).toBe(302);
    expect(head.headers.location).toBe('/api/v1/proxy/plex/thumb/7');
    expect(head.text).toBeUndefined();
  });

  it('keeps info field names and container item count unchanged', async () => {
    const contentAccessService = {
      info: vi.fn().mockResolvedValue({
        kind: 'found', source: 'plex', localId: '7', format: 'video', capabilities: ['playable'],
        item: { id: 'plex:7', title: 'Work', mediaUrl: '/stream', itemType: 'container', metadata: { childCount: 3 } },
      }),
    };
    const res = await request(mounted('/info', createInfoRouter({ contentAccessService }))).get('/info/plex:7');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      contentId: 'plex:7', id: 'plex:7', source: 'plex', title: 'Work', format: 'video',
      capabilities: ['playable'], metadata: { childCount: 3 }, mediaUrl: '/stream', itemCount: 3,
    });
  });

  it('keeps reader pass-through and partial-dismiss status/body unchanged', async () => {
    const feedReaderService = {
      getCategories: vi.fn().mockResolvedValue([{ id: 'news' }]),
      dismiss: vi.fn().mockResolvedValue({ dismissed: 1, failed: ['broken:2'] }),
    };
    const router = createFeedRouter({ feedReaderService, feedPrincipalResolver: { resolve: () => 'alice' } });
    const app = mounted('/feed', router, { json: true });
    expect((await request(app).get('/feed/reader/categories')).body).toEqual([{ id: 'news' }]);
    const dismissed = await request(app).post('/feed/scroll/dismiss').send({ itemIds: ['ok:1', 'broken:2'] });
    expect(dismissed.status).toBe(207);
    expect(dismissed.body).toEqual({ dismissed: 1, failed: ['broken:2'] });
  });
});
