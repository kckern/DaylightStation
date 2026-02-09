// tests/unit/api/routers/display.test.mjs
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createDisplayRouter } from '../../../../backend/src/4_api/v1/routers/display.mjs';

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

  function createApp() {
    const app = express();
    app.use('/display', createDisplayRouter({ registry: mockRegistry, contentIdResolver: mockContentIdResolver }));
    return app;
  }

  it('redirects to thumbnail for /display/plex/12345', async () => {
    mockAdapter.getThumbnailUrl.mockResolvedValue('http://plex.local/thumbnail.jpg');

    const res = await request(createApp()).get('/display/plex/12345');

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/proxy/plex');
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

  it('returns 404 when no thumbnail available', async () => {
    mockAdapter.getThumbnailUrl.mockResolvedValue(null);
    mockAdapter.getItem.mockResolvedValue({ title: 'No thumbnail' });

    const res = await request(createApp()).get('/display/plex/12345');

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('not found');
  });

  it('returns 404 for unknown source', async () => {
    mockRegistry.get.mockReturnValue(null);

    const res = await request(createApp()).get('/display/unknown/12345');

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('Unknown source');
  });
});
