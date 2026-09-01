// tests/unit/api/routers/display.test.mjs
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createDisplayRouter } from '../../../../backend/src/4_api/v1/routers/display.mjs';
import { ContentAccessService } from '../../../../backend/src/3_applications/content/ContentAccessService.mjs';

describe('GET /display/:source/*', () => {
  const mockRegistry = {
    get: vi.fn()
  };

  const mockAdapter = {
    getThumbnailUrl: vi.fn(),
    getItem: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRegistry.get.mockReturnValue(mockAdapter);
  });

  const mockContentIdResolver = {
    resolve: (compoundId) => {
      const colonIdx = compoundId.indexOf(':');
      const source = colonIdx >= 0 ? compoundId.slice(0, colonIdx) : compoundId;
      const localId = colonIdx >= 0 ? compoundId.slice(colonIdx + 1) : '';
      const adapter = mockRegistry.get(source);
      if (!adapter) return null;
      return { source, localId, adapter };
    }
  };

  // The router takes a ContentAccessService now, not the registry/resolver pair
  // it used to. The REAL service is used here with the existing mocks behind it,
  // so these cases still exercise the resolution and fallback logic rather than
  // a second copy of it written in the test.
  const contentCatalog = {
    getThumbnailUrl: (resolved) => resolved.adapter.getThumbnailUrl?.(resolved.localId),
    getItem: (resolved) => resolved.adapter.getItem?.(resolved.localId),
  };

  function createApp() {
    const app = express();
    app.use('/display', createDisplayRouter({
      contentAccessService: new ContentAccessService({
        contentIdResolver: mockContentIdResolver,
        contentCatalog,
      }),
      logger: { error: () => {} },
    }));
    return app;
  }

  it('redirects to thumbnail for /display/plex/12345', async () => {
    mockAdapter.getThumbnailUrl.mockResolvedValue('http://plex.local/thumbnail.jpg');

    const res = await request(createApp()).get('/display/plex/12345');

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/proxy/plex');
    expect(res.headers['cache-control']).toMatch(/max-age=\d+/);
  });

  it('handles compound ID /display/plex:12345', async () => {
    mockAdapter.getThumbnailUrl.mockResolvedValue('http://plex.local/thumbnail.jpg');

    const res = await request(createApp()).get('/display/plex:12345');

    expect(res.status).toBe(302);
    expect(mockAdapter.getThumbnailUrl).toHaveBeenCalledWith('12345');
  });

  it('handles heuristic ID /display/12345 (digits → plex)', async () => {
    mockAdapter.getThumbnailUrl.mockResolvedValue('http://plex.local/thumbnail.jpg');

    const res = await request(createApp()).get('/display/12345');

    expect(res.status).toBe(302);
    expect(mockRegistry.get).toHaveBeenCalledWith('plex');
  });

  it('falls back to getItem().thumbnail when getThumbnailUrl not available', async () => {
    const adapterWithoutThumbnailUrl = {
      getItem: vi.fn().mockResolvedValue({ thumbnail: 'http://example.com/thumb.jpg' })
    };
    mockRegistry.get.mockReturnValue(adapterWithoutThumbnailUrl);

    const res = await request(createApp()).get('/display/plex/12345');

    expect(res.status).toBe(302);
  });

  it('returns a placeholder SVG when no thumbnail available', async () => {
    // 9495fc56b ("Improve talk/readalong playback & placeholders") replaced the
    // 404 here with a generated placeholder SVG so the frontend always has
    // something displayable instead of a broken-image icon.
    mockAdapter.getThumbnailUrl.mockResolvedValue(null);
    mockAdapter.getItem.mockResolvedValue({ title: 'No thumbnail' });

    const res = await request(createApp()).get('/display/plex/12345');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
    expect(res.body.toString()).toContain('<svg');
  });

  it('returns 404 for unknown source', async () => {
    mockRegistry.get.mockReturnValue(null);

    const res = await request(createApp()).get('/display/unknown/12345');

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('Unknown source');
  });
});
